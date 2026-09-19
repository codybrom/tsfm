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
import { Tool } from "./tool.js";
import { GenerationSchema, GeneratedContent, afmSchemaFormat, type JsonSchema } from "./schema.js";
import { GenerationOptions, serializeOptions } from "./options.js";
import { statusToError, FoundationModelsError } from "./errors.js";
import { Transcript } from "./transcript.js";
import { composePrompt, type PromptInput } from "./prompt.js";
import {
  ResponseStream,
  emptyUsage,
  parseUsage,
  usageBetween,
  type Response,
  type Usage,
} from "./response.js";

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

  /** Shared initialization for both constructor and fromTranscript. */
  private _init(pointer: NativePointer, transcript: Transcript): void {
    this._nativeSession = pointer;
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
          model?: SystemLanguageModel;
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

    const pointer = fn.FMLanguageModelSessionCreateFromSystemLanguageModel(
      opts.model?._nativeModel ?? null,
      opts.instructions ?? null,
      toolPointersArg,
      tools.length,
    ) as NativePointer | null;

    if (!pointer) throw new FoundationModelsError("Failed to create LanguageModelSession");
    this._init(pointer, new Transcript(pointer));
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
    opts: { model?: SystemLanguageModel; tools?: Tool[] } = {},
  ): LanguageModelSession {
    const fn = getFunctions();
    const tools = opts.tools ?? [];
    tools.forEach((t) => t._register());
    const toolPointers = tools.map((t) => t._nativeTool);
    const toolPointersArg = tools.length > 0 ? koffi.as(toolPointers, "void **") : null;

    const pointer = fn.FMLanguageModelSessionCreateFromTranscript(
      transcript._nativeSession,
      opts.model?._nativeModel ?? null,
      toolPointersArg,
      tools.length,
    ) as NativePointer | null;

    if (!pointer) throw new FoundationModelsError("Failed to create session from transcript");

    const session = new LanguageModelSession(_FROM_POINTER);
    session._init(pointer, transcript);
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
    return this._enqueue(() => this._withUsage(() => this._respondText(prompt, opts.options)));
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
      this._withUsage(() => this._respondWithSchema(prompt, schema, opts.options)),
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
      this._withUsage(() => this._respondWithJsonSchema(prompt, jsonSchema, opts.options)),
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
   * Token usage accumulated over every response in this session. For one
   * response's usage, use the `usage` on the value `respond()` returns.
   */
  get usage(): Usage {
    return this._readUsage();
  }

  private async *_streamDeltas(
    prompt: string | PromptInput,
    opts: { options?: GenerationOptions },
    onFinished: (usage: Usage) => void,
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
    let composedPrompt: NativePointer | null = null;

    type QueueItem = { content: string } | { done: true; error?: Error };
    const queue: QueueItem[] = [];
    let notifyConsumer: (() => void) | null = null;

    let usageBefore: Usage | null = null;

    try {
      // Wait for requests queued before this stream. Starting early would
      // overlap them on the native session and mix their token usage.
      await previous;
      usageBefore = this._readUsage();
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
              streamDone = true;
              if (keepAlive) clearInterval(keepAlive);
              if (callback) {
                unregisterCallback(callback);
                callback = null;
              }
              const notify = notifyConsumer;
              notifyConsumer = null;
              notify?.();
            }
          }, IDLE_TIMEOUT_MS);
        }
      };

      callback = koffi.register((...args: ResponseCbArgs) => {
        const [status, text] = args;
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
      if (callback) {
        // Callback wasn't unregistered by the handler or idle timer —
        // this means the consumer broke out early (e.g. break/return).
        unregisterCallback(callback);
        callback = null;
      }
      if (fn && !streamDone) {
        // Reset the session after an early break so subsequent calls
        // don't stall waiting for the cancelled stream to finish.
        if (this._nativeSession) fn.FMLanguageModelSessionReset(this._nativeSession);
      }
      if (fn && streamPointer) fn.FMRelease(streamPointer);
      if (fn && composedPrompt) fn.FMRelease(composedPrompt);
      try {
        if (usageBefore) onFinished(usageBetween(usageBefore, this._readUsage()));
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
  private _readUsage(): Usage {
    if (!this._nativeSession) return emptyUsage();
    return parseUsage(
      decodeAndFreeString(
        getFunctions().FMLanguageModelSessionGetUsageJSON(
          this._nativeSession,
        ) as NativePointer | null,
      ),
    );
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
