import { getFunctions, type CountResult, type NativePointer, type Started } from "./bindings.js";
import { FoundationModelsError, statusToError } from "./errors.js";
import { parseCapabilities, type ModelCapability } from "./capabilities.js";
import { composePrompt, type PromptInput } from "./prompt.js";
import type { Tool } from "./tool.js";
import type { GenerationSchema } from "./schema.js";
import type { Transcript } from "./transcript.js";

/**
 * What to measure with `tokenCount()`. Exactly one field applies per call.
 * The C bridge exposes a separate entry point for each kind of input.
 */
export type TokenCountInput =
  | { prompt: string | PromptInput }
  | { instructions: string }
  | { tools: Tool[] }
  | { schema: GenerationSchema }
  | { transcript: Transcript };

/** @internal The host's current locale, as ICU/BCP 47 (e.g. "en-US"). */
export function currentLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}

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
 * Create one instance per application. It is safe to reuse across multiple
 * `LanguageModelSession` instances. Call `isAvailable()` before creating a
 * session, or use `waitUntilAvailable()` in server processes where the model
 * may still be downloading at startup.
 *
 * Call `dispose()` when done to release the underlying C object immediately.
 * Otherwise it is released automatically when the instance is garbage collected.
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
    // The handle releases the native model when it's garbage collected.
    this._nativeModel = fn.FMSystemLanguageModelCreate(
      opts.useCase ?? SystemLanguageModelUseCase.GENERAL,
      opts.guardrails ?? SystemLanguageModelGuardrails.DEFAULT,
    );
    if (!this._nativeModel) {
      throw new FoundationModelsError("Failed to create SystemLanguageModel");
    }
  }

  /**
   * Check whether the model is ready for generation.
   *
   * When `available` is `false`, `reason` indicates why:
   * - `APPLE_INTELLIGENCE_NOT_ENABLED` / `DEVICE_NOT_ELIGIBLE`: permanent.
   *   Retrying will not help.
   * - `MODEL_NOT_READY`: transient. The model is still downloading or
   *   warming up. Use `waitUntilAvailable()` to poll.
   */
  isAvailable(): AvailabilityResult {
    const { available, reason: code } = getFunctions().FMSystemLanguageModelIsAvailable(
      this._model(),
    );
    if (available || code === null) return { available: true };
    const reason = Object.values(SystemLanguageModelUnavailableReason).includes(code)
      ? (code as SystemLanguageModelUnavailableReason)
      : SystemLanguageModelUnavailableReason.UNKNOWN;
    return { available: false, reason };
  }

  /**
   * Resolves when the model becomes available, or once the timeout expires.
   * Useful in long-lived server processes where the model may not be ready
   * immediately at startup. Only retries on MODEL_NOT_READY. Permanent
   * failures (device ineligible, Apple Intelligence disabled) return immediately.
   *
   * @param timeoutMs  Maximum time to wait in milliseconds (default: 30000)
   * @returns The availability result. Check `.available` to confirm success
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
   * All input (instructions, prompts, tool definitions, and responses) counts
   * against this limit.
   */
  get contextSize(): number {
    return getFunctions().FMSystemLanguageModelGetContextSize(this._model());
  }

  /** The model variant, e.g. `"AFM 3 Core Advanced"`, or `null` on macOS 26. */
  get variant(): string | null {
    return getFunctions().FMSystemLanguageModelGetVariantName(this._model());
  }

  /** What the model can do, or `null` on macOS 26. Foundation Models doesn't publish the set. Read it rather than assuming it. */
  get capabilities(): ModelCapability[] | null {
    return parseCapabilities(
      getFunctions().FMSystemLanguageModelGetCapabilitiesJSON(this._model()),
    );
  }

  /**
   * Returns the language identifiers the model supports, as minimal BCP 47 language tags (e.g. `["en-GB", "fr-CA", "de", "ja"]`), not full locales.
   */
  get supportedLanguages(): string[] {
    const json = getFunctions().FMSystemLanguageModelGetSupportedLanguages(this._model());
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
   * Check whether the model supports a locale (the host's current locale when
   * none is given), as the Foundation Models `supportsLocale(_:)` defaults to `.current`.
   *
   * @param localeIdentifier  A BCP 47 / ICU locale string (e.g. `"en_US"`, `"ja_JP"`)
   */
  supportsLocale(localeIdentifier: string = currentLocale()): boolean {
    return getFunctions().FMSystemLanguageModelSupportsLocale(this._model(), localeIdentifier);
  }

  /**
   * Count the tokens a prompt, instruction set, tool list, schema, or
   * transcript would consume against the context window.
   *
   * Each call dispatches asynchronously and owns a native task that is
   * released once the count arrives.
   */
  tokenCount(input: TokenCountInput): Promise<number> {
    const model = this._model();
    return this._countTokens(model, input);
  }

  private async _countTokens(model: NativePointer, input: TokenCountInput): Promise<number> {
    const fn = getFunctions();
    let composed: NativePointer | null = null;
    try {
      let started: Started<CountResult>;
      if ("prompt" in input) {
        composed = composePrompt(fn, input.prompt);
        started = fn.FMSystemLanguageModelTokenCountForPrompt(model, composed);
      } else if ("instructions" in input) {
        started = fn.FMSystemLanguageModelTokenCountForInstructions(model, input.instructions);
      } else if ("tools" in input) {
        // Registered like a session's tools, so every tool is counted.
        started = fn.FMSystemLanguageModelTokenCountForTools(
          model,
          input.tools.map((t) => {
            t._register();
            if (!t._nativeTool)
              throw new FoundationModelsError(`Tool '${t.name}' has no native tool`);
            return t._nativeTool;
          }),
        );
      } else if ("schema" in input) {
        started = fn.FMSystemLanguageModelTokenCountForSchema(model, input.schema._nativeSchema);
      } else {
        started = fn.FMSystemLanguageModelTokenCountForTranscript(
          model,
          input.transcript._pointer(),
        );
      }
      try {
        const { status, count, message } = await started[0];
        if (status !== 0) throw statusToError(status, message ?? undefined);
        return count;
      } finally {
        fn.FMRelease(started[1]);
      }
    } finally {
      if (composed) fn.FMRelease(composed);
    }
  }

  /** The native model, or throws once disposed. */
  private _model(): NativePointer {
    if (!this._nativeModel) throw new FoundationModelsError("Model has been disposed");
    return this._nativeModel;
  }

  dispose(): void {
    if (this._nativeModel) {
      getFunctions().FMRelease(this._nativeModel);
      this._nativeModel = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
