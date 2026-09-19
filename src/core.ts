import koffi from "koffi";
import {
  decodeAndFreeString,
  getFunctions,
  unregisterCallback,
  TokenCountCallbackProto,
  type NativePointer,
  type KoffiCallback,
} from "./bindings.js";
import { FoundationModelsError, statusToError } from "./errors.js";
import { parseCapabilities, type ModelCapability } from "./capabilities.js";
import { composePrompt, type PromptInput } from "./prompt.js";
import type { Tool } from "./tool.js";
import type { GenerationSchema } from "./schema.js";
import type { Transcript } from "./transcript.js";

/**
 * What to measure with `tokenCount()`. Exactly one field applies per call —
 * the C bridge exposes a separate entry point for each kind of input.
 */
export type TokenCountInput =
  | { prompt: string | PromptInput }
  | { instructions: string }
  | { tools: Tool[] }
  | { schema: GenerationSchema }
  | { transcript: Transcript };

const _modelRegistry = new FinalizationRegistry((pointer: NativePointer) => {
  try {
    getFunctions().FMRelease(pointer);
  } catch (err) {
    console.warn("[tsfm] Model cleanup via FinalizationRegistry failed:", err);
  }
});

export enum SystemLanguageModelUseCase {
  GENERAL = 0,
  CONTENT_TAGGING = 1,
}

export enum SystemLanguageModelGuardrails {
  DEFAULT = 0,
  PERMISSIVE_CONTENT_TRANSFORMATIONS = 1,
}

export enum SystemLanguageModelUnavailableReason {
  APPLE_INTELLIGENCE_NOT_ENABLED = 0,
  DEVICE_NOT_ELIGIBLE = 1,
  MODEL_NOT_READY = 2,
  UNKNOWN = 0xff,
}

export interface AvailabilityResult {
  available: boolean;
  /** Present when `available` is false. */
  reason?: SystemLanguageModelUnavailableReason;
}

/**
 * Represents the on-device Apple Intelligence language model.
 *
 * Create one instance per application; it is safe to reuse across multiple
 * `LanguageModelSession` instances. Call `isAvailable()` before creating a
 * session, or use `waitUntilAvailable()` in server processes where the model
 * may still be downloading at startup.
 *
 * Call `dispose()` when done to release the underlying C object immediately;
 * otherwise it is released automatically when the instance is garbage collected.
 */
export class SystemLanguageModel {
  /** @internal */
  _nativeModel: NativePointer | null;

  constructor(
    opts: {
      useCase?: SystemLanguageModelUseCase;
      guardrails?: SystemLanguageModelGuardrails;
    } = {},
  ) {
    const fn = getFunctions();
    this._nativeModel = fn.FMSystemLanguageModelCreate(
      opts.useCase ?? SystemLanguageModelUseCase.GENERAL,
      opts.guardrails ?? SystemLanguageModelGuardrails.DEFAULT,
    ) as NativePointer | null;
    if (!this._nativeModel) {
      throw new FoundationModelsError("Failed to create SystemLanguageModel");
    }
    _modelRegistry.register(this, this._nativeModel, this);
  }

  /**
   * Check whether the model is ready for generation.
   *
   * When `available` is `false`, `reason` indicates why:
   * - `APPLE_INTELLIGENCE_NOT_ENABLED` / `DEVICE_NOT_ELIGIBLE` — permanent;
   *   retrying will not help.
   * - `MODEL_NOT_READY` — transient; the model is still downloading or
   *   warming up. Use `waitUntilAvailable()` to poll.
   */
  isAvailable(): AvailabilityResult {
    const fn = getFunctions();
    const reasonOut = [0];
    const available = fn.FMSystemLanguageModelIsAvailable(this._nativeModel, reasonOut) as boolean;
    if (available) return { available: true };
    const code: number = reasonOut[0];
    const reason = Object.values(SystemLanguageModelUnavailableReason).includes(code)
      ? (code as SystemLanguageModelUnavailableReason)
      : SystemLanguageModelUnavailableReason.UNKNOWN;
    return { available: false, reason };
  }

  /**
   * Resolves when the model becomes available, or once the timeout expires.
   * Useful in long-lived server processes where the model may not be ready
   * immediately at startup. Only retries on MODEL_NOT_READY; permanent
   * failures (device ineligible, Apple Intelligence disabled) return immediately.
   *
   * @param timeoutMs  Maximum time to wait in milliseconds (default: 30000)
   * @returns The availability result — check `.available` to confirm success
   */
  async waitUntilAvailable(timeoutMs = 30_000, intervalMs = 500): Promise<AvailabilityResult> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const result = this.isAvailable();
      if (result.available) return result;
      if (result.reason !== SystemLanguageModelUnavailableReason.MODEL_NOT_READY) {
        // Not a transient condition — don't bother retrying
        return result;
      }
      if (Date.now() >= deadline) return result;
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * The maximum number of tokens the model's context window can hold.
   * All input — instructions, prompts, tool definitions, and responses — counts
   * against this limit.
   */
  get contextSize(): number {
    return getFunctions().FMSystemLanguageModelGetContextSize(this._nativeModel) as number;
  }

  /** The model variant, e.g. `"AFM 3 Core Advanced"`. */
  get variant(): string {
    return (
      decodeAndFreeString(
        getFunctions().FMSystemLanguageModelGetVariantName(
          this._nativeModel,
        ) as NativePointer | null,
      ) ?? ""
    );
  }

  /** What the model can do. The on-device model doesn't reason. */
  get capabilities(): ModelCapability[] {
    return parseCapabilities(
      decodeAndFreeString(
        getFunctions().FMSystemLanguageModelGetCapabilitiesJSON(
          this._nativeModel,
        ) as NativePointer | null,
      ),
    );
  }

  /**
   * Returns the locale identifiers the model supports (e.g. `["en-US", "es-ES"]`).
   */
  get supportedLanguages(): string[] {
    const pointer = getFunctions().FMSystemLanguageModelGetSupportedLanguages(
      this._nativeModel,
    ) as NativePointer | null;
    const json = decodeAndFreeString(pointer);
    if (!json) return [];
    try {
      return JSON.parse(json) as string[];
    } catch {
      throw new FoundationModelsError(
        `Failed to parse supported languages JSON: ${json.slice(0, 200)}`,
      );
    }
  }

  /**
   * Check whether the model supports a given locale.
   *
   * @param localeIdentifier  A BCP 47 / ICU locale string (e.g. `"en_US"`, `"ja_JP"`)
   */
  supportsLocale(localeIdentifier: string): boolean {
    return getFunctions().FMSystemLanguageModelSupportsLocale(
      this._nativeModel,
      localeIdentifier,
    ) as boolean;
  }

  /**
   * Count the tokens a prompt, instruction set, tool list, schema, or
   * transcript would consume against the context window.
   *
   * Each call dispatches asynchronously and owns a native task that is
   * released once the count arrives.
   */
  tokenCount(input: TokenCountInput): Promise<number> {
    const fn = getFunctions();
    const model = this._nativeModel;
    if (!model) throw new FoundationModelsError("Model has been disposed");

    let composed: NativePointer | null = null;
    if ("prompt" in input) composed = composePrompt(fn, input.prompt);

    // Keeps the event loop alive while the native side works, mirroring the
    // response paths.
    const keepAlive = setInterval(() => {}, 10000);

    return new Promise<number>((resolve, reject) => {
      const handle: { task: NativePointer | null; callback: KoffiCallback | null } = {
        task: null,
        callback: null,
      };

      const finish = () => {
        clearInterval(keepAlive);
        if (handle.callback) {
          unregisterCallback(handle.callback);
          handle.callback = null;
        }
        if (handle.task) {
          fn.FMRelease(handle.task);
          handle.task = null;
        }
        if (composed) {
          fn.FMRelease(composed);
          composed = null;
        }
      };

      handle.callback = koffi.register(
        (status: number, count: number, errorDescription: string | null) => {
          finish();
          if (status !== 0) reject(statusToError(status, errorDescription ?? undefined));
          else resolve(count);
        },
        koffi.pointer(TokenCountCallbackProto),
      );

      try {
        const cb = handle.callback;
        if ("prompt" in input) {
          handle.task = fn.FMSystemLanguageModelTokenCountForPrompt(
            model,
            composed,
            null,
            cb,
          ) as NativePointer;
        } else if ("instructions" in input) {
          handle.task = fn.FMSystemLanguageModelTokenCountForInstructions(
            model,
            input.instructions,
            null,
            cb,
          ) as NativePointer;
        } else if ("tools" in input) {
          const pointers = input.tools.map((t) => t._nativeTool);
          handle.task = fn.FMSystemLanguageModelTokenCountForTools(
            model,
            pointers.length > 0 ? koffi.as(pointers, "void **") : null,
            pointers.length,
            null,
            cb,
          ) as NativePointer;
        } else if ("schema" in input) {
          handle.task = fn.FMSystemLanguageModelTokenCountForSchema(
            model,
            input.schema._nativeSchema,
            null,
            cb,
          ) as NativePointer;
        } else {
          handle.task = fn.FMSystemLanguageModelTokenCountForTranscript(
            model,
            input.transcript._nativeSession,
            null,
            cb,
          ) as NativePointer;
        }
      } catch (err) {
        finish();
        reject(err);
      }
    });
  }

  dispose(): void {
    if (this._nativeModel) {
      _modelRegistry.unregister(this);
      getFunctions().FMRelease(this._nativeModel);
      this._nativeModel = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
