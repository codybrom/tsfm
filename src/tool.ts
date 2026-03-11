/**
 * Tool — base class for tools the model can invoke during generation.
 *
 * Subclass this, implement name/description/argumentsSchema/call,
 * then pass instances to LanguageModelSession's tools option.
 */

import koffi from "koffi";
import {
  getFunctions,
  unregisterCallback,
  ToolCallbackProto,
  type KoffiCallback,
  type NativePointer,
} from "./bindings.js";
import { GenerationSchema, GeneratedContent } from "./schema.js";
import { statusToError, ToolCallError } from "./errors.js";

const _toolRegistry = new FinalizationRegistry(
  ({ pointer, callback }: { pointer: NativePointer; callback: KoffiCallback }) => {
    try {
      unregisterCallback(callback);
    } catch {}
    try {
      getFunctions().FMRelease(pointer);
    } catch {}
  },
);

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
   * according to `argumentsSchema`.
   */
  abstract call(args: GeneratedContent): Promise<string>;

  /** @internal Set during registration with a session. */
  _nativeTool: NativePointer | null = null;
  private _callback: KoffiCallback | null = null;

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

    // The tool callback is persistent — unlike one-shot response callbacks,
    // it stays registered for the full lifetime of the tool because the model
    // may invoke this tool multiple times within a single session.
    this._callback = koffi.register((contentRef: NativePointer, callId: number) => {
      try {
        const content = new GeneratedContent(contentRef);
        this.call(content)
          .then((result) => {
            fn.FMBridgedToolFinishCall(this._nativeTool, callId, result);
          })
          .catch((err: unknown) => {
            const cause = err instanceof Error ? err : new Error(String(err));
            const toolErr = new ToolCallError(this.name, cause);
            fn.FMBridgedToolFinishCall(this._nativeTool, callId, toolErr.message);
          });
      } catch (err: unknown) {
        // If anything throws synchronously (e.g. GeneratedContent construction),
        // we must still finish the call or the session hangs forever.
        const msg = err instanceof Error ? err.message : String(err);
        fn.FMBridgedToolFinishCall(this._nativeTool, callId, `Tool callback error: ${msg}`);
      }
    }, koffi.pointer(ToolCallbackProto));

    const errorCode = [0];
    const pointer = fn.FMBridgedToolCreate(
      this.name,
      this.description,
      this.argumentsSchema._nativeSchema,
      this._callback,
      errorCode,
      null,
    );

    if (!pointer) {
      const err = statusToError(errorCode[0], `Failed to create tool '${this.name}'`);
      throw err;
    }

    this._nativeTool = pointer;
    _toolRegistry.register(this, { pointer, callback: this._callback }, this);
  }

  /**
   * Release the underlying C tool object and unregister the native callback.
   *
   * Call this only when you are completely finished with the tool across all
   * sessions. After `dispose()`, the tool cannot be reused with any new
   * session. If you do not call `dispose()`, cleanup happens automatically
   * when the instance is garbage collected.
   */
  dispose(): void {
    if (this._nativeTool || this._callback) {
      _toolRegistry.unregister(this);
    }
    if (this._callback) {
      unregisterCallback(this._callback);
      this._callback = null;
    }
    if (this._nativeTool) {
      getFunctions().FMRelease(this._nativeTool);
      this._nativeTool = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
