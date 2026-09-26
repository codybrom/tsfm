/**
 * Tool: base class for tools the model can invoke during generation.
 *
 * Subclass this, implement name/description/argumentsSchema/call,
 * then pass instances to LanguageModelSession's tools option.
 */

import { getFunctions, type NativePointer } from "./bindings.js";
import { GenerationSchema, GeneratedContent } from "./schema.js";
import {
  statusToError,
  ToolCallError,
  FailRequestError,
  GenerationErrorCode,
  CancelledError,
} from "./errors.js";
import { recordToolFailure, type ToolCallBudget } from "./tool-budget.js";

/** Context for one tool invocation. Cancellation is cooperative. */
export interface ToolCallContext {
  /** Aborted when this invocation is cancelled, or its session or tool is disposed. */
  readonly signal: AbortSignal;
}

export abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly argumentsSchema: GenerationSchema;

  /**
   * Invoked by the model during generation when it decides to use this tool.
   *
   * Return a string result that will be fed back to the model as the tool's
   * output. The model then continues generation with that result in context.
   *
   * **Error handling:** if `call()` throws, the error is caught, converted to
   * a string message, and sent back to the model as the tool's output. The
   * generation does **not** fail. To fail the whole request instead, throw
   * `FailRequestError`: the request then rejects with
   * `RequestFailedByToolError` naming this tool, with the `FailRequestError`
   * as its `cause`. Synchronous throws and rejected Promises behave alike.
   * When concurrent sessions share this tool, each request receives the error
   * from its own invocation, even if the failures have identical messages.
   *
   * `args` contains the structured arguments the model supplied, shaped
   * according to `argumentsSchema`. It's released once `call()` settles, so
   * read what you need from it before then (e.g. `args.toObject()`).
   *
   * `context.signal` is specific to this invocation. Pass it to `fetch()` or
   * check `signal.throwIfAborted()` to stop work when the request is cancelled
   * or its session or this tool is disposed. Existing implementations may ignore the second
   * argument. JavaScript work is only stopped cooperatively.
   */
  abstract call(args: GeneratedContent, context: ToolCallContext): Promise<string>;

  /**
   * Optional callback fired at the start of each tool invocation, before
   * `call()` runs. Useful for showing UI indicators while the model waits
   * for the tool result.
   *
   * @param toolName - The tool's name
   * @param args - The arguments the model supplied, as a plain object
   */
  onCall?: (toolName: string, args: Record<string, unknown>) => void;

  /** @internal Set during registration with a session. */
  _nativeTool: NativePointer | null = null;
  /** Counts registrations, so a call is only answered on the tool that received it. */
  private _registration = 0;
  private _calls = new Map<number, AbortController>();
  private _sessionTools = new Set<WeakRef<Tool>>();

  /** @internal The active request budget for this registration. */
  _budgets = new Set<ToolCallBudget>();

  /**
   * @internal A separate native registration for one session. Calls still run
   * on the user's Tool, preserving subclass state and private fields, but call
   * IDs, cancellation controllers and budgets belong only to this session.
   * Weak references let abandoned sessions and their registrations be collected.
   */
  _bindToSession(): Tool {
    const bound = new SessionTool(this, () => this._sessionTools.delete(ref));
    const ref = new WeakRef<Tool>(bound);
    bound._register();
    for (const existing of this._sessionTools) {
      if (!existing.deref()) this._sessionTools.delete(existing);
    }
    this._sessionTools.add(ref);
    return bound;
  }

  /** @internal Registers a native callback, also used for tool token counts. */
  _register(): void {
    if (this._nativeTool) return; // already registered

    if (!this.argumentsSchema?._nativeSchema) {
      throw new Error(
        `Tool '${this.name}': argumentsSchema must be fully initialized before registration. ` +
          `Ensure argumentsSchema is assigned in the subclass constructor or as a class field.`,
      );
    }

    const fn = getFunctions();
    const registration = ++this._registration;

    // The callback is persistent: the model may call this tool many times, from
    // its session. Each call must be answered, by id, with
    // FMBridgedToolFinishCall or FMBridgedToolFailCall, or the response waits.
    //
    // The addon holds this callback until the native tool is freed, so it must
    // not hold the Tool strongly: a Tool nobody references is collected, which
    // releases its native tool. `current()` is the native tool that received the
    // call, or null once it's disposed or replaced (the addon failed the call).
    const self = new WeakRef(this);
    const current = (): NativePointer | null => {
      const tool = self.deref();
      return tool && tool._registration === registration ? tool._nativeTool : null;
    };
    const onCall = (contentRef: NativePointer | null, callId: number, cancelled = false) => {
      const owner = self.deref();
      const tool = current();
      if (!owner || !tool) {
        // Disposed, or collected before its finalizer ran. The addon fails the
        // call either way -- on release, or when the handle is finalized -- but
        // the arguments are ours now, so release them rather than wait for GC.
        if (contentRef) fn.FMRelease(contentRef);
        return;
      }
      if (cancelled) {
        const controller = owner._calls.get(callId);
        owner._calls.delete(callId);
        controller?.abort(new CancelledError());
        return;
      }
      // The arguments are released once the call settles, on every path.
      let content: GeneratedContent | null = null;
      try {
        if (!contentRef) throw new Error("the tool call arrived without arguments");
        content = new GeneratedContent(contentRef);
        const args = content;

        const budgets = [...owner._budgets];
        const spent = budgets.find((b) => b.used >= b.max);
        if (spent) {
          // Failing the call (rather than answering it) ends the response, which
          // is what stops a toolCallingMode "required" loop.
          args.dispose();
          fn.FMBridgedToolFailCall(
            tool,
            callId,
            GenerationErrorCode.TOOL_CALL_LIMIT_EXCEEDED,
            `The request reached its limit of ${spent.max} tool call${spent.max === 1 ? "" : "s"} ` +
              `(maximumToolCalls). ` +
              `'${owner.name}' was not run.`,
          );
          return;
        }
        for (const b of budgets) b.used++;
        const controller = new AbortController();
        owner._calls.set(callId, controller);

        // Fire onCall notification — informational only, must not block the
        // tool call even if it throws.
        try {
          owner.onCall?.(owner.name, args.toObject() as Record<string, unknown>);
        } catch (err) {
          console.warn(`[tsfm] Tool '${owner.name}' onCall handler threw:`, err);
        }
        // Convert a synchronous throw to a rejection too: both must use the
        // same FailRequestError handling below.
        Promise.resolve()
          .then(() => {
            controller.signal.throwIfAborted();
            return owner.call(args, { signal: controller.signal });
          })
          .then((result) => {
            if (controller.signal.aborted) return;
            // Name the tool and the type here; the addon would only say it
            // expected a string for "output". Thrown, so the catch below still
            // answers the call.
            if (typeof result !== "string") {
              throw new TypeError(
                `call() must resolve with a string, got ${result === null ? "null" : typeof result}`,
              );
            }
            // A disposed tool's pending calls were already failed.
            const answering = current();
            if (answering) fn.FMBridgedToolFinishCall(answering, callId, result);
          })
          .catch((err: unknown) => {
            if (controller.signal.aborted) return;
            const answering = current();
            if (err instanceof FailRequestError) {
              // Failing the call ends the response with REQUEST_FAILED_BY_TOOL.
              // The marker survives both text and structured native errors,
              // so concurrent sessions sharing this tool get their own cause.
              if (answering) {
                const message = recordToolFailure(budgets, owner.name, err);
                fn.FMBridgedToolFailCall(
                  answering,
                  callId,
                  GenerationErrorCode.REQUEST_FAILED_BY_TOOL,
                  message,
                );
              }
              return;
            }
            const cause = err instanceof Error ? err : new Error(String(err));
            const toolErr = new ToolCallError(owner.name, cause);
            if (answering) fn.FMBridgedToolFinishCall(answering, callId, toolErr.message);
          })
          .finally(() => {
            if (owner._calls.get(callId) === controller) owner._calls.delete(callId);
            args.dispose();
          });
      } catch (err: unknown) {
        content?.dispose();
        // If anything throws synchronously (e.g. GeneratedContent construction),
        // the call must still be answered or the response waits forever.
        const msg = err instanceof Error ? err.message : String(err);
        // Disposed meanwhile (e.g. by onCall): the addon already failed the call.
        const answering = current();
        if (answering) {
          fn.FMBridgedToolFinishCall(answering, callId, `Tool callback error: ${msg}`);
        }
      }
    };

    const { value, status, description } = fn.FMBridgedToolCreate(
      this.name,
      this.description,
      this.argumentsSchema._nativeSchema,
      onCall,
    );
    if (!value) {
      throw statusToError(
        status,
        `Failed to create tool '${this.name}'${description ? `: ${description}` : ""}`,
      );
    }
    // The handle releases the tool when it's garbage collected.
    this._nativeTool = value;
  }

  /**
   * Releases the native tool. Calls the model made that haven't been answered
   * yet are failed and their signals are aborted, so no response waits on them.
   */
  dispose(): void {
    const sessions = [...this._sessionTools];
    this._sessionTools.clear();
    for (const ref of sessions) ref.deref()?.dispose();
    if (this._nativeTool) {
      const tool = this._nativeTool;
      this._nativeTool = null;
      const calls = [...this._calls.values()];
      this._calls.clear();
      try {
        getFunctions().FMRelease(tool);
      } finally {
        for (const controller of calls) controller.abort(new CancelledError("Tool disposed"));
      }
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** A native registration owned by one session, forwarding to the user's tool. */
class SessionTool extends Tool {
  readonly name: string;
  readonly description: string;
  readonly argumentsSchema: GenerationSchema;

  constructor(
    private readonly owner: Tool,
    private readonly onDispose: () => void,
  ) {
    super();
    this.name = owner.name;
    this.description = owner.description;
    this.argumentsSchema = owner.argumentsSchema;
  }

  override onCall = (name: string, args: Record<string, unknown>) =>
    this.owner.onCall?.(name, args);

  call(args: GeneratedContent, context: ToolCallContext): Promise<string> {
    return this.owner.call(args, context);
  }

  override dispose(): void {
    this.onDispose();
    super.dispose();
  }
}
