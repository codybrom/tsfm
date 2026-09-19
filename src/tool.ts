/**
 * Tool — base class for tools the model can invoke during generation.
 *
 * Subclass this, implement name/description/argumentsSchema/call,
 * then pass instances to LanguageModelSession's tools option.
 */

import { getFunctions, type NativePointer } from "./bindings.js";
import { GenerationSchema, GeneratedContent } from "./schema.js";
import { statusToError, ToolCallError, GenerationErrorCode } from "./errors.js";
import type { ToolCallBudget } from "./tool-budget.js";

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
   * a string message, and sent back to the model as the tool's output — the
   * generation does **not** fail. If you need the caller to know about tool
   * failures, capture them in the returned string or track them via side
   * effects.
   *
   * `args` contains the structured arguments the model supplied, shaped
   * according to `argumentsSchema`. It's released once `call()` settles, so
   * read what you need from it before then (e.g. `args.toObject()`).
   */
  abstract call(args: GeneratedContent): Promise<string>;

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

  /**
   * @internal Budgets of the requests currently using this tool. A call runs
   * only if every one has room, so a tool shared by sessions that respond at
   * the same time can stop early but never exceeds a request's limit.
   */
  _budgets = new Set<ToolCallBudget>();

  /**
   * @internal Called once before passing to FMBridgedToolCreate.
   *
   * Tool instances can be shared across multiple sessions — the same C tool
   * object and persistent callback are reused. Only call `dispose()` when
   * you are completely done with the tool across all sessions.
   */
  _register(): void {
    if (this._nativeTool) return; // already registered; C object is reusable across sessions

    if (!this.argumentsSchema?._nativeSchema) {
      throw new Error(
        `Tool '${this.name}': argumentsSchema must be fully initialized before registration. ` +
          `Ensure argumentsSchema is assigned in the subclass constructor or as a class field.`,
      );
    }

    const fn = getFunctions();
    const registration = ++this._registration;

    // The callback is persistent: the model may call this tool many times, from
    // any session using it. Each call must be answered, by id, with
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
    const onCall = (contentRef: NativePointer | null, callId: number) => {
      const owner = self.deref();
      const tool = current();
      if (!owner || !tool) return;
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
              `(maximumToolCalls); ` +
              `'${owner.name}' was not run.`,
          );
          return;
        }
        for (const b of budgets) b.used++;

        // Fire onCall notification — informational only, must not block the
        // tool call even if it throws.
        try {
          owner.onCall?.(owner.name, args.toObject() as Record<string, unknown>);
        } catch (err) {
          console.warn(`[tsfm] Tool '${owner.name}' onCall handler threw:`, err);
        }
        owner
          .call(args)
          .then((result) => {
            // A disposed tool's pending calls were already failed.
            const answering = current();
            if (answering) fn.FMBridgedToolFinishCall(answering, callId, result);
          })
          .catch((err: unknown) => {
            const cause = err instanceof Error ? err : new Error(String(err));
            const toolErr = new ToolCallError(owner.name, cause);
            const answering = current();
            if (answering) fn.FMBridgedToolFinishCall(answering, callId, toolErr.message);
          })
          .finally(() => args.dispose());
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
   * yet are failed, so no response waits on them.
   */
  dispose(): void {
    if (this._nativeTool) {
      const tool = this._nativeTool;
      this._nativeTool = null;
      getFunctions().FMRelease(tool);
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
