import koffi from "koffi";
import {
  getFunctions,
  decodeAndFreeString,
  unregisterCallback,
  ResponseCallbackProto,
  StructuredResponseCallbackProto,
  type CallbackProto,
  type KoffiCallback,
  type NativePointer,
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

const _sessionRegistry = new FinalizationRegistry((pointer: NativePointer) => {
  try {
    getFunctions().FMRelease(pointer);
  } catch (err) {
    console.warn("[tsfm] Session cleanup via FinalizationRegistry failed:", err);
  }
});

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
  process.on("exit", _cleanupAllSessions);
  // SIGINT (Ctrl+C) and SIGTERM (kill) don't trigger "exit" by default.
  // Clean up native sessions, then re-raise the signal so the process
  // terminates with the correct exit code / signal disposition.
  // Use `once` so the handler removes itself before re-raising, avoiding a loop.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      _cleanupAllSessions();
      process.kill(process.pid, signal);
    });
  }
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

type ResponseCbArgs = [status: number, content: string | null, _length: number, userInfo: unknown];
type StructuredCbArgs = [status: number, contentRef: NativePointer, userInfo: unknown];

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

  private _activeTask: NativePointer | null = null;
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
    _sessionRegistry.register(this, pointer, this);
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
    const tools = opts.tools ?? [];
    tools.forEach((t) => t._register());

    const toolPointers = tools.map((t) => t._nativeTool);
    const toolPointersArg = tools.length > 0 ? koffi.as(toolPointers, "void **") : null;

    assertModelNotDisposed(opts.model);
    const pcc = opts.model instanceof PrivateCloudComputeLanguageModel ? opts.model : null;
    // Each model type has its own native constructor; the pointers aren't interchangeable.
    const pointer = (
      pcc
        ? fn.FMLanguageModelSessionCreateFromPrivateCloudComputeModel(
            pcc._nativeModel,
            opts.instructions ?? null,
            toolPointersArg,
            tools.length,
          )
        : fn.FMLanguageModelSessionCreateFromSystemLanguageModel(
            (opts.model as SystemLanguageModel | undefined)?._nativeModel ?? null,
            opts.instructions ?? null,
            toolPointersArg,
            tools.length,
          )
    ) as NativePointer | null;

    if (!pointer) throw new FoundationModelsError("Failed to create LanguageModelSession");
    this._init(pointer, new Transcript(pointer), tools);
    this._usesPrivateCloudCompute = pcc !== null;
  }

  /**
   * Create a session pre-loaded with a saved transcript.
   *
   * The supplied `transcript` object is updated in-place to reflect the new
   * session's pointer; any subsequent `transcript.toJson()` calls will read
   * from the new session.
   */
  static fromTranscript(
    transcript: Transcript,
    opts: { model?: SystemLanguageModel | PrivateCloudComputeLanguageModel; tools?: Tool[] } = {},
  ): LanguageModelSession {
    const fn = getFunctions();
    const tools = opts.tools ?? [];
    tools.forEach((t) => t._register());
    const toolPointers = tools.map((t) => t._nativeTool);
    const toolPointersArg = tools.length > 0 ? koffi.as(toolPointers, "void **") : null;

    assertModelNotDisposed(opts.model);
    const pcc = opts.model instanceof PrivateCloudComputeLanguageModel ? opts.model : null;
    const pointer = (
      pcc
        ? fn.FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel(
            transcript._nativeSession,
            pcc._nativeModel,
            toolPointersArg,
            tools.length,
          )
        : fn.FMLanguageModelSessionCreateFromTranscript(
            transcript._nativeSession,
            (opts.model as SystemLanguageModel | undefined)?._nativeModel ?? null,
            toolPointersArg,
            tools.length,
          )
    ) as NativePointer | null;

    if (!pointer) throw new FoundationModelsError("Failed to create session from transcript");

    const session = new LanguageModelSession(_FROM_POINTER);
    session._init(pointer, transcript, tools);
    session._usesPrivateCloudCompute = pcc !== null;
    // Update the transcript's native session so future toJson() calls read
    // from the new session rather than the original deserialized transcript.
    transcript._updateNativeSession(pointer);
    return session;
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
    return getFunctions().FMLanguageModelSessionIsResponding(this._nativeSession) as boolean;
  }

  /**
   * Request cancellation of any in-progress generation and reset the session
   * to idle.
   *
   * **Cancellation is advisory:** the native task is signalled, but an
   * in-flight callback may still fire and resolve or reject the pending Promise
   * after `cancel()` returns. Callers should discard any result that arrives
   * after calling `cancel()`.
   */
  cancel(): void {
    if (this._disposed) return;
    if (this._activeTask) {
      getFunctions().FMTaskCancel(this._activeTask);
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
    // release() is always called. If a native call or koffi.register throws
    // before the consumer loop, the queue would stall permanently otherwise.
    let fn: ReturnType<typeof getFunctions> | null = null;
    let streamPointer: NativePointer | null = null;
    let callback: KoffiCallback | null = null;
    let keepAlive: ReturnType<typeof setInterval> | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let streamDone = false;
    // Set when the consumer stops before the native stream ends. The native task
    // always makes one final call (end, error or "cancelled"), so the callback
    // must stay registered until then: native code calling an unregistered
    // callback kills the host.
    let draining = false;
    let composedPrompt: NativePointer | null = null;

    type QueueItem = { content: string } | { done: true; error?: Error };
    const queue: QueueItem[] = [];
    let notifyConsumer: (() => void) | null = null;

    let usageBefore: Usage | null = null;
    // Set once usage was read before the request; a null reading (macOS 26)
    // still finishes the stream with null usage.
    let readUsageBefore = false;
    let budget: ToolCallBudget | null = null;

    try {
      // Wait for requests queued before this stream. Starting early would
      // overlap them on the native session and mix their token usage.
      await previous;
      // dispose() may have run while this stream waited in the queue; passing
      // the released (null) session to native code would crash the host.
      this._assertNotDisposed();
      this._assertOptionsSupported(opts.options);
      usageBefore = this._readUsage();
      readUsageBefore = true;
      budget = this._lendToolBudget(opts.options);
      fn = getFunctions();
      const optionsJson = serializeOptions(opts.options);

      composedPrompt = composePrompt(fn, prompt);
      streamPointer = fn.FMLanguageModelSessionStreamResponse(
        this._nativeSession,
        composedPrompt,
        optionsJson,
      ) as NativePointer;

      // FMLanguageModelSessionResponseStreamIterate spawns a single Swift Task
      // that calls the callback once per chunk, then once more with null content
      // when done. We buffer arriving chunks into a queue and drain them.
      keepAlive = setInterval(() => {}, 10000);

      // Idle timeout: if no callback fires within this window after a tool-call
      // snapshot ("null" artifact), assume the stream has stalled and terminate
      // with an error rather than hanging forever. Only armed in the tool-call
      // snapshot branch — normal content chunks do not reset this timer.
      const IDLE_TIMEOUT_MS = 30_000;

      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (!streamDone) {
          idleTimer = setTimeout(() => {
            if (!streamDone) {
              queue.push({
                done: true,
                error: new Error(
                  "Stream idle timeout: no callback received within 30s of the previous snapshot",
                ),
              });
              // The native stream may still call back, so drain instead of unregistering.
              streamDone = true;
              draining = true;
              if (keepAlive) clearInterval(keepAlive);
              const notify = notifyConsumer;
              notifyConsumer = null;
              notify?.();
            }
          }, IDLE_TIMEOUT_MS);
        }
      };

      callback = koffi.register((...args: ResponseCbArgs) => {
        const [status, text] = args;
        if (draining) {
          // The consumer is gone; wait for the final call, then let go.
          if ((status !== 0 || !text) && callback) {
            unregisterCallback(callback);
            callback = null;
          }
          return;
        }
        // The `str` parameter of ResponseCallbackProto is marshalled by koffi
        // before the handler runs: a non-null char* arrives as a JS string and
        // the end-of-stream null pointer arrives as JS null. Calling
        // koffi.decode() here would trigger N-API exceptions, so the value is
        // used as delivered.
        if (status !== 0) {
          queue.push({ done: true, error: statusToError(status, text) });
          streamDone = true;
          if (keepAlive) clearInterval(keepAlive);
          if (idleTimer) clearTimeout(idleTimer);
          if (callback) {
            unregisterCallback(callback);
            callback = null;
          }
        } else if (!text) {
          // null/empty content = end-of-stream signal
          queue.push({ done: true });
          streamDone = true;
          if (keepAlive) clearInterval(keepAlive);
          if (idleTimer) clearTimeout(idleTimer);
          if (callback) {
            unregisterCallback(callback);
            callback = null;
          }
        } else {
          // Every non-empty snapshot is real content, including the literal
          // text "null" — koffi marshals the end-of-stream signal to JS null,
          // handled above, and never to the string, so there is no artifact to
          // filter here. Discarding by value swallowed any response that ended
          // as exactly "null".
          queue.push({ content: text });
          // Arm the stall detector between snapshots: if the native side stops
          // calling back mid-response the consumer should fail rather than
          // wait forever. A tool that runs before the first snapshot is not
          // covered, so slow tools do not trip it.
          resetIdleTimer();
        }
        const notify = notifyConsumer;
        notifyConsumer = null;
        notify?.();
      }, koffi.pointer(ResponseCallbackProto));

      fn.FMLanguageModelSessionResponseStreamIterate(streamPointer, null, callback);

      // Apple's ResponseStream yields cumulative snapshots, not deltas.
      // Track previous content and yield only the new suffix each iteration.
      let prevLen = 0;
      let cancelled = false;

      // Allow cancel() to unblock the consumer when the native callback stops firing.
      this._cancelStream = () => {
        cancelled = true;
        queue.push({ done: true });
        const notify = notifyConsumer;
        notifyConsumer = null;
        notify?.();
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
          if (item.error) throw item.error;
          break;
        }
        const delta = item.content.slice(prevLen);
        prevLen = item.content.length;
        if (delta) yield delta;
      }
    } finally {
      this._cancelStream = null;
      if (keepAlive) clearInterval(keepAlive);
      if (idleTimer) clearTimeout(idleTimer);
      if (callback && !draining) {
        // Still registered, so the consumer stopped early (break, return or
        // cancel()) and the native stream will call back at least once more.
        // Releasing the stream below cancels it, which makes that call prompt.
        draining = true;
      }
      if (fn && !streamDone) {
        // Reset the session after an early break so subsequent calls
        // don't stall waiting for the cancelled stream to finish.
        if (this._nativeSession) fn.FMLanguageModelSessionReset(this._nativeSession);
      }
      if (fn && streamPointer) fn.FMRelease(streamPointer);
      if (fn && composedPrompt) fn.FMRelease(composedPrompt);
      if (budget) this._returnToolBudget(budget);
      try {
        if (readUsageBefore) onFinished(usageBetween(usageBefore, this._readUsage()));
      } finally {
        // Always unlock the queue, even if reading usage fails, or every later
        // request on this session would wait forever.
        release();
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
    // The transcript reads through the session's pointer, which is released below.
    this._transcript?._detach();
    if (this._nativeSession) {
      _sessionRegistry.unregister(this);
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
    return parseUsage(
      decodeAndFreeString(
        getFunctions().FMLanguageModelSessionGetUsageJSON(
          this._nativeSession,
        ) as NativePointer | null,
      ),
    );
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

  // Register a one-shot koffi callback with keepalive and auto-cleanup.
  // The handler is called after the keepalive interval is cleared and the
  // callback is unregistered — callers only supply the domain logic.
  private _oneShotCallback<TArgs extends unknown[]>(
    proto: CallbackProto,
    handler: (...args: TArgs) => void,
  ): KoffiCallback {
    const keepAlive = setInterval(() => {}, 10000);
    const callback = koffi.register((...args: TArgs) => {
      clearInterval(keepAlive);
      unregisterCallback(callback);
      handler(...args);
    }, koffi.pointer(proto));
    return callback;
  }

  private _runResponseCallback(callC: (callback: KoffiCallback) => NativePointer): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const callback = this._oneShotCallback<ResponseCbArgs>(
        ResponseCallbackProto,
        (status, content) => {
          this._activeTask = null;
          // See streaming callback comment — use value directly, not koffi.decode()
          if (status !== 0) reject(statusToError(status, content));
          else resolve(content ?? "");
        },
      );
      this._activeTask = callC(callback);
    });
  }

  private _runStructuredCallback(
    callC: (callback: KoffiCallback) => NativePointer,
  ): Promise<GeneratedContent> {
    return new Promise<GeneratedContent>((resolve, reject) => {
      const callback = this._oneShotCallback<StructuredCbArgs>(
        StructuredResponseCallbackProto,
        (status, contentRef) => {
          this._activeTask = null;
          if (status !== 0) {
            // contentRef may be null on error; FMGeneratedContentGetJSONString
            // and FMRelease are no-ops on null per the C API contract.
            const msg = decodeAndFreeString(
              getFunctions().FMGeneratedContentGetJSONString(contentRef) as NativePointer | null,
            );
            getFunctions().FMRelease(contentRef);
            reject(statusToError(status, msg ?? undefined));
          } else {
            resolve(new GeneratedContent(contentRef));
          }
        },
      );
      this._activeTask = callC(callback);
    });
  }

  private _respondText(
    prompt: string | PromptInput,
    options: GenerationOptions | undefined,
  ): Promise<string> {
    this._assertNotDisposed();
    this._assertOptionsSupported(options);
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const composedPrompt = composePrompt(fn, prompt);
    return this._runResponseCallback(
      (callback) =>
        fn.FMLanguageModelSessionRespond(
          this._nativeSession,
          composedPrompt,
          optionsJson,
          null,
          callback,
        ) as NativePointer,
    ).finally(() => fn.FMRelease(composedPrompt));
  }

  private _respondWithSchema(
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
    return this._runStructuredCallback(
      (callback) =>
        fn.FMLanguageModelSessionRespondWithSchema(
          this._nativeSession,
          composedPrompt,
          schema._nativeSchema,
          optionsJson,
          null,
          callback,
        ) as NativePointer,
    ).finally(() => fn.FMRelease(composedPrompt));
  }

  private _respondWithJsonSchema(
    prompt: string | PromptInput,
    jsonSchema: JsonSchema,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    this._assertNotDisposed();
    this._assertOptionsSupported(options);
    if (jsonNestingDepth(jsonSchema, MAX_SCHEMA_DEPTH) > MAX_SCHEMA_DEPTH) {
      throw new InvalidGenerationSchemaError(
        `The schema nests more than ${MAX_SCHEMA_DEPTH} levels of JSON deep. ` +
          "Flatten it, or move nested shapes into $defs and refer to them with $ref.",
      );
    }
    this._assertRegexGuidesSupported(jsonSchema);
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const schemaJson = JSON.stringify(afmSchemaFormat(jsonSchema));
    const composedPrompt = composePrompt(fn, prompt);
    return this._runStructuredCallback(
      (callback) =>
        fn.FMLanguageModelSessionRespondWithSchemaFromJSON(
          this._nativeSession,
          composedPrompt,
          schemaJson,
          optionsJson,
          null,
          callback,
        ) as NativePointer,
    ).finally(() => fn.FMRelease(composedPrompt));
  }
}
