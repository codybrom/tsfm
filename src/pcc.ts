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
import { hasMacOS27, requireMacOS27, runtimeMacOSMajor } from "./os.js";

const _pccRegistry = new FinalizationRegistry((pointer: NativePointer) => {
  try {
    getFunctions().FMRelease(pointer);
  } catch (err) {
    console.warn("[tsfm] PCC model cleanup via FinalizationRegistry failed:", err);
  }
});

export enum PrivateCloudComputeUnavailableReason {
  DEVICE_NOT_ELIGIBLE = 1,
  SYSTEM_NOT_READY = 2,
  /**
   * The host process isn't signed with the managed entitlement
   * `com.apple.developer.private-cloud-compute`. Plain `node` can't carry it;
   * it has to be an app (e.g. Electron) signed with a provisioning profile that
   * includes the entitlement.
   */
  ENTITLEMENT_MISSING = 3,
  /** This Mac runs macOS 26; Private Cloud Compute needs macOS 27 or later. */
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

/**
 * Apple's server model, run on Private Cloud Compute: a 32K-token context and
 * reasoning (`GenerationOptions.reasoningLevel`), with a daily per-user quota.
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
    this._nativeModel =
      getFunctions().FMPrivateCloudComputeLanguageModelCreate() as NativePointer | null;
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
    _pccRegistry.register(this, this._nativeModel, this);
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
    const reasonOut = [0];
    const available = getFunctions().FMPrivateCloudComputeLanguageModelIsAvailable(
      this._assertNotDisposed(),
      reasonOut,
    ) as boolean;
    if (available) return { available: true };
    const code = reasonOut[0];
    const reason = Object.values(PrivateCloudComputeUnavailableReason).includes(code)
      ? (code as PrivateCloudComputeUnavailableReason)
      : PrivateCloudComputeUnavailableReason.UNKNOWN;
    return { available: false, reason };
  }

  /** Polls while the system isn't ready yet; returns at once for other reasons. */
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
      decodeAndFreeString(
        getFunctions().FMPrivateCloudComputeLanguageModelGetCapabilitiesJSON(
          this._assertNotDisposed(),
        ) as NativePointer | null,
      ),
    );
  }

  /** The user's daily quota, or `null` on macOS 26. */
  get quotaUsage(): PrivateCloudComputeQuotaUsage | null {
    if (this._requiresNewerOS && !this._disposed) return null;
    const json = decodeAndFreeString(
      getFunctions().FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON(
        this._assertNotDisposed(),
      ) as NativePointer | null,
    );
    const raw = json ? (JSON.parse(json) as Record<string, unknown>) : {};
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
      };
      handle.callback = koffi.register(
        (status: number, size: number, errorDescription: string | null) => {
          finish();
          if (status !== 0) reject(statusToError(status, errorDescription ?? undefined));
          else resolve(size);
        },
        koffi.pointer(TokenCountCallbackProto),
      );
      try {
        handle.task = fn.FMPrivateCloudComputeLanguageModelGetContextSize(
          model,
          null,
          handle.callback,
        ) as NativePointer;
      } catch (err) {
        finish();
        reject(err);
      }
    });
  }

  dispose(): void {
    this._disposed = true;
    if (this._nativeModel) {
      _pccRegistry.unregister(this);
      getFunctions().FMRelease(this._nativeModel);
      this._nativeModel = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
