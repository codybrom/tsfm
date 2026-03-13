import { decodeAndFreeString, getFunctions, type NativePointer } from "./bindings.js";
import { FoundationModelsError } from "./errors.js";

const _modelRegistry = new FinalizationRegistry((pointer: NativePointer) => {
  try {
    getFunctions().FMRelease(pointer);
  } catch {}
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

  // macOS 26.4+ runtime only — uncomment when targeting 26.4+
  // /** Returns the number of tokens the model would use to encode the given text. */
  // tokenCount(text: string): number {
  //   return getFunctions().FMSystemLanguageModelGetTokenCount(this._nativeModel, text) as number;
  // }

  /**
   * Returns the locale identifiers the model supports (e.g. `["en-US", "es-ES"]`).
   */
  get supportedLanguages(): string[] {
    const pointer = getFunctions().FMSystemLanguageModelGetSupportedLanguages(
      this._nativeModel,
    ) as NativePointer | null;
    const json = decodeAndFreeString(pointer);
    if (!json) return [];
    return JSON.parse(json) as string[];
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
