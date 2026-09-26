import {
  getFunctions,
  type NativePointer,
  type RequestHandle,
  type Started,
  type StructuredResult,
  type TextResult,
} from "./bindings.js";
import { SystemLanguageModel } from "./core.js";
import { PrivateCloudComputeLanguageModel } from "./pcc.js";
import { Tool } from "./tool.js";
import { ToolCallBudget } from "./tool-budget.js";
import {
  GenerationSchema,
  GeneratedContent,
  afmSchemaFormat,
  jsonNestingDepth,
  MAX_SCHEMA_DEPTH,
  type JsonSchema,
} from "./schema.js";
import { GenerationOptions, serializeOptions, resolveMaximumToolCalls } from "./options.js";
import {
  statusToError,
  FoundationModelsError,
  GenerationError,
  RequestFailedByToolError,
  UnsupportedGuideError,
  UnsupportedCapabilityError,
  InvalidGenerationSchemaError,
} from "./errors.js";
import { collectSchemaPatterns, findUnsupportedRegexConstruct } from "./regex-support.js";
import { Transcript } from "./transcript.js";
import { composePrompt, type PromptInput } from "./prompt.js";
import { hasMacOS27, requireMacOS27 } from "./os.js";
import { ResponseStream, parseUsage, usageBetween, type Response, type Usage } from "./response.js";

/** Sentinel object passed to the constructor to skip the C API call. */
const _FROM_POINTER = Symbol("fromPointer");

// Track live sessions so we can release them when the process exits.
// Orphaned native sessions can crash the Apple Intelligence safety service.
// Uses WeakRef so forgotten sessions can still be garbage-collected.
const _liveSessions = new Set<WeakRef<LanguageModelSession>>();

function _cleanupAllSessions(): void {
  for (const ref of _liveSessions) {
    try {
      ref.deref()?.dispose();
    } catch (err) {
      console.warn("[tsfm] Session cleanup on exit failed:", err);
    }
  }
  _liveSessions.clear();
}

let _exitHandlerInstalled = false;
function _installExitHandler(): void {
  if (_exitHandlerInstalled) return;
  _exitHandlerInstalled = true;
  // Only "exit". A library must not take over SIGINT or SIGTERM: a host that
  // handles them itself (to drain a server, say) would be killed or run its
  // handler twice. A process that dies from a signal skips this cleanup, which
  // is safe: the addon never lets a native callback reach JavaScript that's gone.
  process.on("exit", _cleanupAllSessions);
}

/**
 * A disposed model has no native pointer. Passing null to the PCC constructors
 * would crash the host in Swift, and the on-device constructor would quietly
 * fall back to the default model, dropping the disposed model's use case and
 * guardrails.
 */
function assertModelNotDisposed(
  model: SystemLanguageModel | PrivateCloudComputeLanguageModel | undefined,
): void {
  // On macOS 26 a PCC model has no native pointer; say why instead of "disposed".
  if (model instanceof PrivateCloudComputeLanguageModel && model._requiresNewerOS) {
    requireMacOS27("Private Cloud Compute");
  }
  if (model && !model._nativeModel) {
    throw new FoundationModelsError(`${model.constructor.name} has been disposed`);
  }
}

/**
 * The error message of a failed structured request. The addon reads it from
 * the bridge's error content as JSON, and the bridge builds that content from
 * a string, so it arrives quoted and escaped. Text and stream errors arrive
 * plain, and statusToError matches the reset-date marker at the start of the
 * message, so the quotes have to come off first.
 */
function decodeStructuredMessage(message: string | null): string | undefined {
  if (message == null) return undefined;
  try {
    const decoded: unknown = JSON.parse(message);
    if (typeof decoded === "string") return decoded;
  } catch {
    // Not JSON, so it is already the plain message.
  }
  return message;
}

/**
 * A request's rejection, with the tool's name and error filled in when a tool
 * failed it with FailRequestError (see ToolCallBudget.failures).
 */
function withToolFailure(err: unknown, budget: ToolCallBudget): unknown {
  if (err instanceof RequestFailedByToolError && err._failureId && !err.toolName) {
    const failure = budget.failures.get(err._failureId);
    if (failure) err._attach(failure.toolName, failure.cause);
  }
  return err;
}

/**
 * Creates session-owned registrations. Rejects a tool listed twice and two
 * tools with one name: the model addresses tools by name, so the framework
 * couldn't route such a call, and whether it fails or traps on the duplicate
 * isn't documented.
 */
function bindTools(tools: Tool[]): Tool[] {
  const seen = new Map<string, Tool>();
  for (const t of tools) {
    const other = seen.get(t.name);
    if (other === t) throw new FoundationModelsError(`Tool '${t.name}' is listed more than once`);
    if (other)
      throw new FoundationModelsError(`Two tools are named '${t.name}'; names must be unique`);
    seen.set(t.name, t);
  }
  const bound: Tool[] = [];
  try {
    for (const tool of tools) bound.push(tool._bindToSession());
    return bound;
  } catch (error) {
    for (const tool of bound) tool.dispose();
    throw error;
  }
}

function nativeTools(tools: Tool[]): NativePointer[] {
  return tools.map((t) => {
    if (!t._nativeTool) throw new FoundationModelsError(`Tool '${t.name}' has been disposed`);
    return t._nativeTool;
  });
}

export class LanguageModelSession {
  /** @internal */
  _nativeSession: NativePointer | null = null;

  private _transcript: Transcript | null = null;
  private _weakRef: WeakRef<LanguageModelSession> | null = null;

  get transcript(): Transcript {
    if (!this._transcript) {
      throw new FoundationModelsError("Session not initialized");
    }
    return this._transcript;
  }

  private _activeTask: RequestHandle | null = null;
  private _queue = Promise.resolve();

  /** Callback set by an active stream generator; called by cancel() to unblock it. */
  private _cancelStream: (() => void) | null = null;

  /** Set synchronously by dispose(); checked by _assertNotDisposed(). */
  private _disposed = false;
  /** Tools the session was created with; each request lends them a call budget. */
  private _tools: Tool[] = [];
  /** Whether requests run on Private Cloud Compute rather than on-device. */
  private _usesPrivateCloudCompute = false;

  /** Shared initialization for both constructor and fromTranscript. */
  private _init(pointer: NativePointer, transcript: Transcript, tools: Tool[]): void {
    this._nativeSession = pointer;
    this._tools = tools;
    this._transcript = transcript;
    // The handle also releases the native session when it's garbage collected.
    this._weakRef = new WeakRef(this);
    _liveSessions.add(this._weakRef);
    _installExitHandler();
  }

  constructor(
    opts:
      | {
          instructions?: string;
          /** The on-device model (default) or `PrivateCloudComputeLanguageModel`. */
          model?: SystemLanguageModel | PrivateCloudComputeLanguageModel;
          tools?: Tool[];
        }
      | typeof _FROM_POINTER = {},
  ) {
    if (opts === _FROM_POINTER) return; // shell instance — _init() called by fromTranscript

    const fn = getFunctions();
    const tools = bindTools([...(opts.tools ?? [])]);
    try {
      const toolHandles = nativeTools(tools);

      assertModelNotDisposed(opts.model);
      const pcc = opts.model instanceof PrivateCloudComputeLanguageModel ? opts.model : null;
      // Each model type has its own native constructor; the handles aren't interchangeable.
      const pointer = pcc
        ? fn.FMLanguageModelSessionCreateFromPrivateCloudComputeModel(
            pcc._nativeModel!,
            opts.instructions ?? null,
            toolHandles,
          )
        : fn.FMLanguageModelSessionCreateFromSystemLanguageModel(
            (opts.model as SystemLanguageModel | undefined)?._nativeModel ?? null,
            opts.instructions ?? null,
            toolHandles,
          );

      if (!pointer) throw new FoundationModelsError("Failed to create LanguageModelSession");
      this._init(pointer, new Transcript(pointer), tools);
      this._usesPrivateCloudCompute = pcc !== null;
    } catch (error) {
      for (const tool of tools) tool.dispose();
      throw error;
    }
  }

  /**
   * Create a session pre-loaded with a saved transcript.
   *
   * The supplied `transcript` object is updated in-place to reflect the new
   * session's pointer; any subsequent `transcript.toJson()` calls will read
   * from the new session, and once that session is disposed the transcript is
   * detached and throws. A transcript that is already disposed or detached is
   * refused with FoundationModelsError.
   */
  static fromTranscript(
    transcript: Transcript,
    opts: { model?: SystemLanguageModel | PrivateCloudComputeLanguageModel; tools?: Tool[] } = {},
  ): LanguageModelSession {
    const fn = getFunctions();
    const tools = bindTools([...(opts.tools ?? [])]);
    try {
      const toolHandles = nativeTools(tools);

      assertModelNotDisposed(opts.model);
      const source = transcript._pointer();
      // A transcript that belongs to a session is that session's live view: the
      // bridge represents both as a session handle, so repointing it below would
      // silently redirect the original session's transcript at this one, and
      // disposing this session would break it. Export and restore instead.
      if (!transcript._ownsObject) {
        throw new FoundationModelsError(
          "This transcript belongs to a session. Export it first: " +
            "LanguageModelSession.fromTranscript(Transcript.fromJson(session.transcript.toJson()))",
        );
      }
      const pcc = opts.model instanceof PrivateCloudComputeLanguageModel ? opts.model : null;
      const pointer = pcc
        ? fn.FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel(
            source,
            pcc._nativeModel!,
            toolHandles,
          )
        : fn.FMLanguageModelSessionCreateFromTranscript(
            source,
            (opts.model as SystemLanguageModel | undefined)?._nativeModel ?? null,
            toolHandles,
          );

      if (!pointer) throw new FoundationModelsError("Failed to create session from transcript");

      const session = new LanguageModelSession(_FROM_POINTER);
      session._init(pointer, transcript, tools);
      session._usesPrivateCloudCompute = pcc !== null;
      // Update the transcript's native session so future toJson() calls read
      // from the new session rather than the original deserialized transcript.
      transcript._updateNativeSession(pointer);
      return session;
    } catch (error) {
      for (const tool of tools) tool.dispose();
      throw error;
    }
  }

  /**
   * Preload model resources and optionally cache a prompt prefix to reduce
   * first-response latency. Fire-and-forget — the prewarm runs in the
   * background on the native side.
   *
   * @param promptPrefix  Optional text the model should expect at the start of the first prompt.
   */
  prewarm(promptPrefix?: string): void {
    if (this._disposed || !this._nativeSession) return;
    getFunctions().FMLanguageModelSessionPrewarm(this._nativeSession, promptPrefix ?? null);
  }

  /** Whether the session is currently processing a request (backed by C API). */
  get isResponding(): boolean {
    if (this._disposed || !this._nativeSession) return false;
    return getFunctions().FMLanguageModelSessionIsResponding(this._nativeSession);
  }

  /**
   * Request cancellation of the generation currently running. Requests waiting
   * in the session's queue are not removed.
   *
   * **Cancellation is advisory:** the native task is signalled, but an
   * in-flight callback may still fire and resolve or reject the pending Promise
   * after `cancel()` returns. Callers should discard any result that arrives
   * after calling `cancel()`.
   *
   * For streams, cancellation unblocks a waiting iterator; iteration ends on
   * its next step. Cleanup waits for native completion before releasing the queue lock,
   * so the session can be used again. `collect()` returns the text received so
   * far. For one-shot requests, await settlement before treating cancellation
   * as complete; a stopped request rejects with `CancelledError`.
   */
  cancel(): void {
    if (this._disposed) return;
    if (this._activeTask) {
      const fn = getFunctions();
      fn.FMRequestCancel(this._activeTask);
      // The request's finally owns the handle. In particular, stream cleanup
      // still needs to cancel it before releasing it and unlocking the queue.
      this._activeTask = null;
    }
    // Unblock any waiting stream consumer so the generator can exit.
    this._cancelStream?.();
    this._cancelStream = null;
    if (this._nativeSession) getFunctions().FMLanguageModelSessionReset(this._nativeSession);
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  /** @internal Throws if the session has been disposed. */
  private _assertNotDisposed(): void {
    if (this._disposed) {
      throw new FoundationModelsError(
        "Session has been disposed. Create a new LanguageModelSession to continue.",
      );
    }
  }

  /**
   * Send a prompt and return the model's plain-text response with its token
   * usage. Read the text from `.content`.
   *
   * Concurrent calls are serialized — they queue up and run one at a time
   * rather than racing over the same session. Throws a `GenerationError`
   * subclass on failure.
   */
  async respond(
    prompt: string | PromptInput,
    opts: { options?: GenerationOptions } = {},
  ): Promise<Response<string>> {
    this._assertNotDisposed();
    return this._enqueue(() =>
      this._withUsage(() =>
        this._withToolBudget(opts.options, () => this._respondText(prompt, opts.options)),
      ),
    );
  }

  /**
   * Send a prompt and return structured output conforming to `schema`.
   *
   * Uses the native `GenerationSchema` builder API. For plain JSON Schema
   * objects, use `respondWithJsonSchema` instead.
   * Throws a `GenerationError` subclass on failure.
   */
  async respondWithSchema(
    prompt: string | PromptInput,
    schema: GenerationSchema,
    opts: { options?: GenerationOptions } = {},
  ): Promise<Response<GeneratedContent>> {
    this._assertNotDisposed();
    return this._enqueue(() =>
      this._withUsage(() =>
        this._withToolBudget(opts.options, () =>
          this._respondWithSchema(prompt, schema, opts.options),
        ),
      ),
    );
  }

  /**
   * Send a prompt and return structured output conforming to a plain JSON
   * Schema object.
   *
   * The schema is normalized before sending: a `title` default, an
   * `additionalProperties: false` constraint, and an `x-order` key are
   * injected automatically if not already present.
   * Throws a `GenerationError` subclass on failure.
   */
  async respondWithJsonSchema(
    prompt: string | PromptInput,
    jsonSchema: JsonSchema,
    opts: { options?: GenerationOptions } = {},
  ): Promise<Response<GeneratedContent>> {
    this._assertNotDisposed();
    return this._enqueue(() =>
      this._withUsage(() =>
        this._withToolBudget(opts.options, () =>
          this._respondWithJsonSchema(prompt, jsonSchema, opts.options),
        ),
      ),
    );
  }

  /**
   * Stream the model's response one text delta at a time.
   *
   * Returns a `ResponseStream`: iterate it for string deltas, then read
   * `.usage` once it finishes (or call `.collect()` for the full `Response`).
   * The underlying stream delivers cumulative snapshots; each is diffed
   * against the previous to emit only the new suffix.
   *
   * **Queue lock:** the session's request queue is held for the duration of
   * the stream. Concurrent `respond()` / `streamResponse()` calls will wait
   * until the generator is fully consumed or broken out of. Always iterate to
   * completion or use `break` / `return` to release the lock:
   *
   * ```ts
   * for await (const chunk of session.streamResponse("prompt")) {
   *   process.stdout.write(chunk);
   *   if (done) break; // releases the lock immediately
   * }
   * ```
   *
   * Throws a `GenerationError` subclass if the stream ends with an error.
   */
  streamResponse(
    prompt: string | PromptInput,
    opts: { options?: GenerationOptions } = {},
  ): ResponseStream {
    return new ResponseStream((onFinished) => this._streamDeltas(prompt, opts, onFinished));
  }

  /**
   * Token usage accumulated over every response in this session, or `null` on
   * macOS 26 (which doesn't report usage) and once the session is disposed. For
   * one response's usage, use the `usage` on the value `respond()` returns.
   */
  get usage(): Usage | null {
    return this._readUsage();
  }

  private async *_streamDeltas(
    prompt: string | PromptInput,
    opts: { options?: GenerationOptions },
    onFinished: (usage: Usage | null) => void,
  ): AsyncGenerator<string> {
    this._assertNotDisposed();
    // streamResponse cannot use _enqueue: _enqueue expects a single Promise<T>
    // to chain on, but a generator yields multiple values over time and the
    // queue must stay locked until the entire stream is consumed. Instead we
    // manually chain a lock-promise onto _queue and release it in `finally`.
    let release!: () => void;
    const lock = new Promise<void>((res) => (release = res));
    const previous = this._queue;
    this._queue = previous.then(() => lock);

    // All setup after the queue lock MUST be inside try/finally so that
    // release() is always called. If a native call throws before the consumer
    // loop, the queue would stall permanently otherwise.
    let fn: ReturnType<typeof getFunctions> | null = null;
    let request: RequestHandle | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let streamDone = false;
    // Stopping the consumer does not mean Apple's generation has stopped.
    // Keep the session queue locked until its terminal native callback arrives.
    const nativeFinished = Promise.withResolvers<void>();
    let composedPrompt: NativePointer | null = null;

    type QueueItem = { content: string } | { done: true; error?: Error };
    const queue: QueueItem[] = [];
    let notifyConsumer: (() => void) | null = null;
    const notify = () => {
      const resolve = notifyConsumer;
      notifyConsumer = null;
      resolve?.();
    };

    let usageBefore: Usage | null = null;
    // Set once usage was read before the request; a null reading (macOS 26)
    // still finishes the stream with null usage.
    let readUsageBefore = false;
    let budget: ToolCallBudget | null = null;

    try {
      // Wait for requests queued before this stream. Starting early would
      // overlap them on the native session and mix their token usage.
      await previous;
      // dispose() may have run while this stream waited in the queue; the
      // released session can't start a request.
      this._assertNotDisposed();
      this._assertOptionsSupported(opts.options);
      usageBefore = this._readUsage();
      readUsageBefore = true;
      budget = this._lendToolBudget(opts.options);
      fn = getFunctions();
      const optionsJson = serializeOptions(opts.options);

      // Idle timeout: if no callback fires within this window after a
      // snapshot, assume the stream has stalled and end it with an error
      // rather than hanging forever. Armed between snapshots only, so a slow
      // tool before the first snapshot doesn't trip it.
      const IDLE_TIMEOUT_MS = 30_000;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (streamDone) return;
        idleTimer = setTimeout(() => {
          if (streamDone) return;
          queue.push({
            done: true,
            error: new GenerationError(
              "Stream idle timeout: no callback received within 30s of the previous snapshot",
            ),
          });
          streamDone = true;
          notify();
        }, IDLE_TIMEOUT_MS);
      };

      // The addon calls this with cumulative snapshots, then once more: null
      // text at the end, or a non-zero status on error. It keeps the process
      // alive until then, and absorbs anything after the consumer stops.
      const onChunk = (status: number, text: string | null) => {
        if (status !== 0 || text === null) nativeFinished.resolve();
        if (streamDone) return; // stopped, timed out or cancelled
        if (status !== 0) {
          queue.push({ done: true, error: statusToError(status, text) });
          streamDone = true;
          if (idleTimer) clearTimeout(idleTimer);
        } else if (text === null) {
          queue.push({ done: true });
          streamDone = true;
          if (idleTimer) clearTimeout(idleTimer);
        } else {
          // Every snapshot is real content, including the literal text "null".
          queue.push({ content: text });
          resetIdleTimer();
        }
        notify();
      };

      composedPrompt = composePrompt(fn, prompt);
      request = fn.FMLanguageModelSessionStreamResponse(
        this._nativeSession!,
        composedPrompt,
        optionsJson,
        onChunk,
      );
      this._activeTask = request;
      if (!request) {
        streamDone = true;
        throw new FoundationModelsError("The stream couldn't start; check the generation options.");
      }

      // Apple's ResponseStream yields cumulative snapshots, not deltas.
      // Track previous content and yield only the new suffix each iteration.
      let prevLen = 0;
      let cancelled = false;

      // Allow cancel() to unblock the consumer when the native callback stops firing.
      this._cancelStream = () => {
        cancelled = true;
        queue.push({ done: true });
        notify();
      };

      while (true) {
        while (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notifyConsumer = resolve;
          });
        }
        if (cancelled) break;
        const item = queue.shift()!;
        if ("done" in item) {
          if (item.error) throw budget ? withToolFailure(item.error, budget) : item.error;
          break;
        }
        const delta = item.content.slice(prevLen);
        prevLen = item.content.length;
        if (delta) yield delta;
      }
    } finally {
      this._cancelStream = null;
      if (this._activeTask === request) this._activeTask = null;
      if (idleTimer) clearTimeout(idleTimer);
      const stoppedEarly = !streamDone;
      streamDone = true; // late chunks are ignored from here
      try {
        if (fn && request) {
          // Cancelling a stream that already ended is a no-op; otherwise the
          // native task ends and its final call is absorbed by the addon.
          try {
            fn.FMRequestCancel(request);
            await nativeFinished.promise;
          } finally {
            fn.FMRelease(request);
          }
        }
      } finally {
        try {
          if (fn && composedPrompt) fn.FMRelease(composedPrompt);
          if (fn && stoppedEarly && this._nativeSession) {
            // Reset after an early break before subsequent requests start.
            fn.FMLanguageModelSessionReset(this._nativeSession);
          }
          if (readUsageBefore) onFinished(usageBetween(usageBefore, this._readUsage()));
        } finally {
          if (budget) this._returnToolBudget(budget);
          // Always unlock, even if native cleanup or reading usage fails.
          release();
        }
      }
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._weakRef) {
      _liveSessions.delete(this._weakRef);
      this._weakRef = null;
    }
    for (const tool of this._tools) tool.dispose();
    // The transcript reads through the session's pointer, which is released below.
    this._transcript?._detach();
    if (this._nativeSession) {
      getFunctions().FMRelease(this._nativeSession);
      this._nativeSession = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // -------------------------------------------------------------------------
  // Private implementation
  // -------------------------------------------------------------------------

  /** Cumulative usage from the native session, or zeros once disposed. */
  private _readUsage(): Usage | null {
    if (!this._nativeSession) return null;
    return parseUsage(getFunctions().FMLanguageModelSessionGetUsageJSON(this._nativeSession));
  }

  /**
   * Rejects regex guides the on-device model can't use, before the request.
   * Unsupported patterns otherwise fail with an opaque error, or with (?:…)
   * send the model into a response that fills the context window.
   */
  private _assertRegexGuidesSupported(jsonSchema: JsonSchema): void {
    // Private Cloud Compute supports the patterns the on-device model doesn't.
    if (this._usesPrivateCloudCompute) return;
    // The support table was measured on the macOS 27 model. The macOS 26 model
    // isn't characterized, so its patterns go through unchecked, as in 0.x.
    if (!hasMacOS27()) return;
    for (const { path, pattern } of collectSchemaPatterns(jsonSchema)) {
      const construct = findUnsupportedRegexConstruct(pattern);
      if (construct) {
        throw new UnsupportedGuideError(
          `The on-device model doesn't support ${construct}, in the regex guide ` +
            `${JSON.stringify(pattern)} at ${path}.`,
        );
      }
    }
  }

  /**
   * Only Private Cloud Compute reasons. On-device, the framework fails a
   * reasoningLevel with an error older hosts can't identify, so reject it here.
   */
  private _assertOptionsSupported(options: GenerationOptions | undefined): void {
    // "allowed" is the default behavior, so it works on macOS 26 too.
    if (options?.toolCallingMode !== undefined && options.toolCallingMode !== "allowed") {
      requireMacOS27(`toolCallingMode "${options.toolCallingMode}"`);
    }
    if (options?.reasoningLevel !== undefined && !this._usesPrivateCloudCompute) {
      throw new UnsupportedCapabilityError(
        "reasoningLevel needs PrivateCloudComputeLanguageModel; the on-device model doesn't reason.",
      );
    }
  }

  /** Attaches a fresh tool-call budget for one request to the session's tools. */
  private _lendToolBudget(options: GenerationOptions | undefined): ToolCallBudget {
    const budget = new ToolCallBudget(resolveMaximumToolCalls(options));
    for (const tool of this._tools) tool._budgets.add(budget);
    return budget;
  }

  private _returnToolBudget(budget: ToolCallBudget): void {
    for (const tool of this._tools) tool._budgets.delete(budget);
  }

  /** Runs one request with its own tool-call budget (maximumToolCalls). */
  private async _withToolBudget<T>(
    options: GenerationOptions | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    const budget = this._lendToolBudget(options);
    try {
      return await run();
    } catch (err) {
      throw withToolFailure(err, budget);
    } finally {
      this._returnToolBudget(budget);
    }
  }

  /**
   * Runs one request and pairs its result with the tokens it used: the change
   * in the session's cumulative usage. Only called inside the request queue,
   * so no other request can run in between.
   */
  private async _withUsage<T>(run: () => Promise<T>): Promise<Response<T>> {
    const before = this._readUsage();
    const content = await run();
    return { content, usage: usageBetween(before, this._readUsage()) };
  }

  // Enforces sequential execution: concurrent respond() calls are queued and
  // run one at a time rather than racing over the same native session.
  private _enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this._queue.then(() => fn());
    this._queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  /** Runs a one-shot text request, keeping its handle for cancel(). */
  private async _runText(start: () => Started<TextResult>): Promise<string> {
    const [result, request] = start();
    this._activeTask = request;
    try {
      const { status, text } = await result;
      if (status !== 0) throw statusToError(status, text);
      return text ?? "";
    } finally {
      if (this._activeTask === request) this._activeTask = null;
      // Settled (or cancelled): the handle is no longer needed.
      getFunctions().FMRelease(request);
    }
  }

  /** Runs a one-shot structured request, keeping its handle for cancel(). */
  private async _runStructured(start: () => Started<StructuredResult>): Promise<GeneratedContent> {
    const [result, request] = start();
    this._activeTask = request;
    try {
      const { status, content, message } = await result;
      if (status !== 0) throw statusToError(status, decodeStructuredMessage(message));
      if (!content) throw new FoundationModelsError("The response had no content");
      return new GeneratedContent(content);
    } finally {
      if (this._activeTask === request) this._activeTask = null;
      // Settled (or cancelled): the handle is no longer needed.
      getFunctions().FMRelease(request);
    }
  }

  // Each request method owns the composed prompt (+1) and releases it in a
  // finally, whether starting the request throws or the request settles.

  private async _respondText(
    prompt: string | PromptInput,
    options: GenerationOptions | undefined,
  ): Promise<string> {
    this._assertNotDisposed();
    this._assertOptionsSupported(options);
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const composedPrompt = composePrompt(fn, prompt);
    try {
      return await this._runText(() =>
        fn.FMLanguageModelSessionRespond(this._nativeSession!, composedPrompt, optionsJson),
      );
    } finally {
      fn.FMRelease(composedPrompt);
    }
  }

  private async _respondWithSchema(
    prompt: string | PromptInput,
    schema: GenerationSchema,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    this._assertNotDisposed();
    this._assertOptionsSupported(options);
    let dict: JsonSchema | null = null;
    try {
      dict = schema.toDict();
    } catch {
      // Can't read the schema back; the model still rejects bad patterns itself.
    }
    if (dict) this._assertRegexGuidesSupported(dict);
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const composedPrompt = composePrompt(fn, prompt);
    try {
      return await this._runStructured(() =>
        fn.FMLanguageModelSessionRespondWithSchema(
          this._nativeSession!,
          composedPrompt,
          schema._nativeSchema,
          optionsJson,
        ),
      );
    } finally {
      fn.FMRelease(composedPrompt);
    }
  }

  private async _respondWithJsonSchema(
    prompt: string | PromptInput,
    jsonSchema: JsonSchema,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    this._assertNotDisposed();
    this._assertOptionsSupported(options);
    if (jsonNestingDepth(jsonSchema, MAX_SCHEMA_DEPTH) > MAX_SCHEMA_DEPTH) {
      throw new InvalidGenerationSchemaError(
        `The schema nests more than ${MAX_SCHEMA_DEPTH} levels of JSON deep, or contains itself. ` +
          "Flatten it, or move nested shapes into $defs and refer to them with $ref.",
      );
    }
    this._assertRegexGuidesSupported(jsonSchema);
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const schemaJson = JSON.stringify(afmSchemaFormat(jsonSchema));
    const composedPrompt = composePrompt(fn, prompt);
    try {
      return await this._runStructured(() =>
        fn.FMLanguageModelSessionRespondWithSchemaFromJSON(
          this._nativeSession!,
          composedPrompt,
          schemaJson,
          optionsJson,
        ),
      );
    } finally {
      fn.FMRelease(composedPrompt);
    }
  }
}
