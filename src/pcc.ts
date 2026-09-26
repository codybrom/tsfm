import { getFunctions, type NativePointer } from "./bindings.js";
import { FoundationModelsError, statusToError } from "./errors.js";
import { parseCapabilities, type ModelCapability } from "./capabilities.js";
import { currentLocale } from "./core.js";
import { hasMacOS27, requireMacOS27, runtimeMacOSMajor } from "./os.js";

export enum PrivateCloudComputeUnavailableReason {
  DEVICE_NOT_ELIGIBLE = 1,
  SYSTEM_NOT_READY = 2,
  /**
   * The host process isn't signed with the managed entitlement
   * `com.apple.developer.private-cloud-compute`. Plain `node` can't carry it.
   * It has to be an app (e.g. Electron) signed with a provisioning profile that
   * includes the entitlement.
   */
  ENTITLEMENT_MISSING = 3,
  /** This Mac runs macOS 26. Private Cloud Compute needs macOS 27 or later. */
  REQUIRES_NEWER_OS = 4,
  UNKNOWN = 0xff,
}

export interface PrivateCloudComputeAvailability {
  available: boolean;
  /** Present when `available` is false. */
  reason?: PrivateCloudComputeUnavailableReason;
}

/** The user's daily Private Cloud Compute quota. */
export interface PrivateCloudComputeQuotaUsage {
  limitReached: boolean;
  approachingLimit: boolean;
  /** When the quota resets, if known. */
  resetDate: Date | null;
}

/** The bridge's quota JSON, or a typed error like the other parsers. */
function parseQuotaUsage(json: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    raw = undefined;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new FoundationModelsError(
      `Failed to parse Private Cloud Compute quota JSON: ${json.slice(0, 200)}`,
    );
  }
  return raw as Record<string, unknown>;
}

/**
 * The Foundation Models server model, run on Private Cloud Compute: a 32K-token
 * context and reasoning (`GenerationOptions.reasoningLevel`), with a daily
 * per-user quota.
 *
 * Opt-in, and only usable on macOS 27 or later from a host process signed with
 * the managed entitlement `com.apple.developer.private-cloud-compute`. Check
 * `isAvailable()`: without the entitlement it reports `ENTITLEMENT_MISSING`, and
 * requests fail with `PrivateCloudComputeEntitlementError`. On macOS 26 it
 * reports `REQUIRES_NEWER_OS`, and using it throws `UnsupportedCapabilityError`.
 *
 * ```ts
 * const model = new PrivateCloudComputeLanguageModel();
 * if (model.isAvailable().available) {
 *   const session = new LanguageModelSession({ model });
 *   const { content } = await session.respond("Compare these designs…", {
 *     options: { reasoningLevel: "moderate" },
 *   });
 * }
 * ```
 */
export class PrivateCloudComputeLanguageModel {
  /** @internal */
  _nativeModel: NativePointer | null;
  /** @internal True on macOS 26, where there's no native model to create. */
  readonly _requiresNewerOS: boolean;
  private _disposed = false;

  constructor() {
    if (!hasMacOS27()) {
      this._nativeModel = null;
      this._requiresNewerOS = true;
      return;
    }
    // The handle releases the native model when it's garbage collected.
    this._nativeModel = getFunctions().FMPrivateCloudComputeLanguageModelCreate();
    if (!this._nativeModel) {
      // The bridge returns NULL before macOS 27. When the version couldn't be
      // read, that's the explanation; on a known macOS 27 it's a real failure.
      if (runtimeMacOSMajor() !== null) {
        throw new FoundationModelsError("Failed to create PrivateCloudComputeLanguageModel");
      }
      this._requiresNewerOS = true;
      return;
    }
    this._requiresNewerOS = false;
  }

  private _assertNotDisposed(): NativePointer {
    if (this._disposed) throw new FoundationModelsError("Model has been disposed");
    if (!this._nativeModel) {
      requireMacOS27("Private Cloud Compute");
      throw new FoundationModelsError("Failed to create PrivateCloudComputeLanguageModel");
    }
    return this._nativeModel;
  }

  /** Whether requests can run now, and if not, why. */
  isAvailable(): PrivateCloudComputeAvailability {
    if (this._requiresNewerOS && !this._disposed) {
      return { available: false, reason: PrivateCloudComputeUnavailableReason.REQUIRES_NEWER_OS };
    }
    const { available, reason: code } =
      getFunctions().FMPrivateCloudComputeLanguageModelIsAvailable(this._assertNotDisposed());
    if (available || code === null) return { available: true };
    const reason = Object.values(PrivateCloudComputeUnavailableReason).includes(code)
      ? (code as PrivateCloudComputeUnavailableReason)
      : PrivateCloudComputeUnavailableReason.UNKNOWN;
    return { available: false, reason };
  }

  /** Polls while the system isn't ready yet, and returns at once for other reasons. */
  async waitUntilAvailable(
    timeoutMs = 30_000,
    intervalMs = 500,
  ): Promise<PrivateCloudComputeAvailability> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const result = this.isAvailable();
      if (result.available) return result;
      if (result.reason !== PrivateCloudComputeUnavailableReason.SYSTEM_NOT_READY) return result;
      if (Date.now() >= deadline) return result;
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /** What the model can do, including reasoning, or `null` on macOS 26. */
  get capabilities(): ModelCapability[] | null {
    if (this._requiresNewerOS && !this._disposed) return null;
    return parseCapabilities(
      getFunctions().FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(
        this._assertNotDisposed(),
      ),
    );
  }

  /**
   * The language identifiers the model supports, as minimal BCP 47 language tags (e.g. `["en-GB", "fr-CA", "de", "ja"]`), not full locales.
   *
   * **Asynchronous**, unlike `SystemLanguageModel.supportedLanguages` (a
   * synchronous getter): Foundation Models defined it `async throws` on
   * `PrivateCloudComputeLanguageModel`, as with `contextSize()`. Resolves `[]`
   * on macOS 26, which has no Private Cloud Compute.
   */
  supportedLanguages(): Promise<string[]> {
    if (this._requiresNewerOS && !this._disposed) return Promise.resolve([]);
    let model: NativePointer;
    try {
      model = this._assertNotDisposed();
    } catch (err) {
      return Promise.reject(err);
    }
    const fn = getFunctions();
    const [result, request] = fn.FMPrivateCloudComputeLanguageModelGetSupportedLanguages(model);
    return result
      .then(({ status, text }) => {
        if (status !== 0) throw statusToError(status, text ?? undefined);
        if (!text) return [];
        try {
          return JSON.parse(text) as string[];
        } catch {
          throw new FoundationModelsError(
            `Failed to parse supported languages JSON: ${text.slice(0, 200)}`,
          );
        }
      })
      .finally(() => fn.FMRelease(request));
  }

  /**
   * Whether the model supports a locale (the host's current locale when none is
   * given), as the Foundation Models `supportsLocale(_:)` defaults to `.current`.
   *
   * **Asynchronous**, unlike `SystemLanguageModel.supportsLocale()` (synchronous):
   * Foundation Models defined it `async throws` on `PrivateCloudComputeLanguageModel`.
   * Resolves `false` on macOS 26, which has no Private Cloud Compute.
   *
   * @param localeIdentifier  A BCP 47 / ICU locale string (e.g. `"en_US"`, `"ja_JP"`)
   */
  supportsLocale(localeIdentifier: string = currentLocale()): Promise<boolean> {
    if (this._requiresNewerOS && !this._disposed) return Promise.resolve(false);
    let model: NativePointer;
    try {
      model = this._assertNotDisposed();
    } catch (err) {
      return Promise.reject(err);
    }
    const fn = getFunctions();
    const [result, request] = fn.FMPrivateCloudComputeLanguageModelSupportsLocale(
      model,
      localeIdentifier,
    );
    return result
      .then(({ status, count, message }) => {
        if (status !== 0) throw statusToError(status, message ?? undefined);
        return count === 1;
      })
      .finally(() => fn.FMRelease(request));
  }

  /** The user's daily quota, or `null` on macOS 26. */
  get quotaUsage(): PrivateCloudComputeQuotaUsage | null {
    if (this._requiresNewerOS && !this._disposed) return null;
    const json = getFunctions().FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON(
      this._assertNotDisposed(),
    );
    const raw = json ? parseQuotaUsage(json) : {};
    return {
      limitReached: raw.limitReached === true,
      approachingLimit: raw.approachingLimit === true,
      resetDate: typeof raw.resetDate === "string" ? new Date(raw.resetDate) : null,
    };
  }

  /** The context window size in tokens (asynchronous for this model). */
  contextSize(): Promise<number> {
    let model: NativePointer;
    try {
      model = this._assertNotDisposed();
    } catch (err) {
      return Promise.reject(err);
    }
    const fn = getFunctions();
    const [result, request] = fn.FMPrivateCloudComputeLanguageModelGetContextSize(model);
    return result
      .then(({ status, count, message }) => {
        if (status !== 0) throw statusToError(status, message ?? undefined);
        return count;
      })
      .finally(() => fn.FMRelease(request));
  }

  dispose(): void {
    this._disposed = true;
    if (this._nativeModel) {
      getFunctions().FMRelease(this._nativeModel);
      this._nativeModel = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
