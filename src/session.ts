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

/** Sentinel object passed to the constructor to skip the C API call. */
const _FROM_POINTER = Symbol("fromPointer");

const _sessionRegistry = new FinalizationRegistry((pointer: NativePointer) => {
  try {
    getFunctions().FMRelease(pointer);
  } catch {}
});

// Track live sessions so we can release them when the process exits.
// Orphaned native sessions can crash the Apple Intelligence safety service.
// Uses WeakRef so forgotten sessions can still be garbage-collected.
const _liveSessions = new Set<WeakRef<LanguageModelSession>>();

function _cleanupAllSessions(): void {
  for (const ref of _liveSessions) {
    try {
      ref.deref()?.dispose();
    } catch {}
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

type ResponseCbArgs = [status: number, content: string, _length: number, userInfo: unknown];
type StructuredCbArgs = [status: number, contentRef: NativePointer, userInfo: unknown];

export class LanguageModelSession {
  /** @internal */
  _nativeSession: NativePointer | null = null;

  private _transcript: Transcript | null = null;
  private _weakRef: WeakRef<LanguageModelSession> | null = null;

  get transcript(): Transcript {
    if (!this._transcript) throw new FoundationModelsError("Session not initialized");
    return this._transcript;
  }

  private _activeTask: NativePointer | null = null;
  private _queue = Promise.resolve();

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
    );

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
    );

    if (!pointer) throw new FoundationModelsError("Failed to create session from transcript");

    const session = new LanguageModelSession(_FROM_POINTER);
    session._init(pointer, transcript);
    // Update the transcript's native session so future toJson() calls read
    // from the new session rather than the original deserialized transcript.
    transcript._updateNativeSession(pointer);
    return session;
  }

  /** Whether the session is currently processing a request (backed by C API). */
  get isResponding(): boolean {
    if (!this._nativeSession) return false;
    return getFunctions().FMLanguageModelSessionIsResponding(this._nativeSession);
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
    if (this._activeTask) {
      getFunctions().FMTaskCancel(this._activeTask);
      this._activeTask = null;
    }
    if (this._nativeSession) getFunctions().FMLanguageModelSessionReset(this._nativeSession);
  }

  // -------------------------------------------------------------------------
  // Text generation
  // -------------------------------------------------------------------------

  /**
   * Send a prompt and return the model's plain-text response.
   *
   * Concurrent calls are serialized — they queue up and run one at a time
   * rather than racing over the same session. Throws a `GenerationError`
   * subclass on failure.
   */
  async respond(prompt: string, opts: { options?: GenerationOptions } = {}): Promise<string> {
    return this._enqueue(() => this._respondText(prompt, opts.options));
  }

  /**
   * Send a prompt and return structured output conforming to `schema`.
   *
   * Uses the native `GenerationSchema` builder API. For plain JSON Schema
   * objects, use `respondWithJsonSchema` instead.
   * Throws a `GenerationError` subclass on failure.
   */
  async respondWithSchema(
    prompt: string,
    schema: GenerationSchema,
    opts: { options?: GenerationOptions } = {},
  ): Promise<GeneratedContent> {
    return this._enqueue(() => this._respondWithSchema(prompt, schema, opts.options));
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
    prompt: string,
    jsonSchema: JsonSchema,
    opts: { options?: GenerationOptions } = {},
  ): Promise<GeneratedContent> {
    return this._enqueue(() => this._respondWithJsonSchema(prompt, jsonSchema, opts.options));
  }

  /**
   * Stream the model's response one text delta at a time.
   *
   * Yields string deltas as they arrive. The underlying stream delivers
   * cumulative snapshots; this method diffs each snapshot against the
   * previous to emit only the new suffix.
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
  async *streamResponse(
    prompt: string,
    opts: { options?: GenerationOptions } = {},
  ): AsyncGenerator<string> {
    // streamResponse cannot use _enqueue: _enqueue expects a single Promise<T>
    // to chain on, but a generator yields multiple values over time and the
    // queue must stay locked until the entire stream is consumed. Instead we
    // manually chain a lock-promise onto _queue and release it in `finally`.
    let release!: () => void;
    const lock = new Promise<void>((res) => (release = res));
    this._queue = this._queue.then(() => lock);

    const fn = getFunctions();
    const optionsJson = serializeOptions(opts.options);

    const streamPointer = fn.FMLanguageModelSessionStreamResponse(
      this._nativeSession,
      prompt,
      optionsJson,
    );

    // FMLanguageModelSessionResponseStreamIterate spawns a single Swift Task
    // that calls the callback once per chunk, then once more with null content
    // when done. We buffer arriving chunks into a queue and drain them.
    type QueueItem = { content: string } | { done: true; error?: Error };
    const queue: QueueItem[] = [];
    let notifyConsumer: (() => void) | null = null;
    let streamDone = false;
    const keepAlive = setInterval(() => {}, 10000);

    const callback = koffi.register((...args: ResponseCbArgs) => {
      const [status, content] = args;
      if (status !== 0) {
        queue.push({ done: true, error: statusToError(status, content) });
        streamDone = true;
        clearInterval(keepAlive);
        unregisterCallback(callback);
      } else if (!content) {
        // null content = end-of-stream signal
        queue.push({ done: true });
        streamDone = true;
        clearInterval(keepAlive);
        unregisterCallback(callback);
      } else {
        queue.push({ content });
      }
      const notify = notifyConsumer;
      notifyConsumer = null;
      notify?.();
    }, koffi.pointer(ResponseCallbackProto));

    fn.FMLanguageModelSessionResponseStreamIterate(streamPointer, null, callback);

    // Apple's ResponseStream yields cumulative snapshots, not deltas.
    // Track previous content and yield only the new suffix each iteration.
    let prevLen = 0;

    try {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            notifyConsumer = resolve;
          });
        }
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
      clearInterval(keepAlive);
      if (!streamDone) {
        unregisterCallback(callback);
      }
      fn.FMRelease(streamPointer);
      release();
    }
  }

  dispose(): void {
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
              getFunctions().FMGeneratedContentGetJSONString(contentRef),
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

  private _respondText(prompt: string, options: GenerationOptions | undefined): Promise<string> {
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    return this._runResponseCallback((callback) =>
      fn.FMLanguageModelSessionRespond(this._nativeSession, prompt, optionsJson, null, callback),
    );
  }

  private _respondWithSchema(
    prompt: string,
    schema: GenerationSchema,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    return this._runStructuredCallback((callback) =>
      fn.FMLanguageModelSessionRespondWithSchema(
        this._nativeSession,
        prompt,
        schema._nativeSchema,
        optionsJson,
        null,
        callback,
      ),
    );
  }

  private _respondWithJsonSchema(
    prompt: string,
    jsonSchema: JsonSchema,
    options: GenerationOptions | undefined,
  ): Promise<GeneratedContent> {
    const fn = getFunctions();
    const optionsJson = serializeOptions(options);
    const schemaJson = JSON.stringify(afmSchemaFormat(jsonSchema));
    return this._runStructuredCallback((callback) =>
      fn.FMLanguageModelSessionRespondWithSchemaFromJSON(
        this._nativeSession,
        prompt,
        schemaJson,
        optionsJson,
        null,
        callback,
      ),
    );
  }
}
