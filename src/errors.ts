/**
 * Status codes from the native bridge. A regular enum, not a `const enum`, so it
 * exists at runtime and callers don't compile the numbers into their own code.
 */
export enum GenerationErrorCode {
  SUCCESS = 0,
  EXCEEDED_CONTEXT_WINDOW_SIZE = 1,
  ASSETS_UNAVAILABLE = 2,
  GUARDRAIL_VIOLATION = 3,
  UNSUPPORTED_GUIDE = 4,
  UNSUPPORTED_LANGUAGE_OR_LOCALE = 5,
  DECODING_FAILURE = 6,
  RATE_LIMITED = 7,
  CONCURRENT_REQUESTS = 8,
  REFUSAL = 9,
  INVALID_SCHEMA = 10,
  INVALID_ARGUMENT = 11,
  TIMEOUT = 12,
  UNSUPPORTED_CAPABILITY = 13,
  UNSUPPORTED_TRANSCRIPT_CONTENT = 14,
  TOOL_CALL_LIMIT_EXCEEDED = 15,
  PCC_NETWORK_FAILURE = 16,
  PCC_QUOTA_LIMIT_REACHED = 17,
  PCC_SERVICE_UNAVAILABLE = 18,
  PCC_ENTITLEMENT_MISSING = 19,
  UNKNOWN_ERROR = 255,
}

export class FoundationModelsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundationModelsError";
  }
}

/** Why the C bridge refused a prompt attachment. */
export type PromptAttachmentFailure = "unsupported-os" | "unsupported-sdk" | "unknown";

/**
 * Raised when an attachment cannot be added to a prompt.
 *
 * Attachments need macOS 27; on macOS 26 the reason is `unsupported-os`. The
 * bundled library is built with the macOS 27 SDK, so it never reports
 * `unsupported-sdk`; that reason remains for libraries built without it.
 */
export class PromptAttachmentError extends FoundationModelsError {
  readonly reason: PromptAttachmentFailure;

  constructor(message: string, reason: PromptAttachmentFailure) {
    super(message);
    this.name = "PromptAttachmentError";
    this.reason = reason;
  }
}

export class GenerationError extends FoundationModelsError {
  constructor(message: string) {
    super(message);
    this.name = "GenerationError";
  }
}

export class ExceededContextWindowSizeError extends GenerationError {
  constructor(msg = "Context window size exceeded") {
    super(msg);
    this.name = "ExceededContextWindowSizeError";
  }
}

export class AssetsUnavailableError extends GenerationError {
  constructor(msg = "Required assets unavailable") {
    super(msg);
    this.name = "AssetsUnavailableError";
  }
}

export class GuardrailViolationError extends GenerationError {
  constructor(msg = "Guardrail violation") {
    super(msg);
    this.name = "GuardrailViolationError";
  }
}

export class UnsupportedGuideError extends GenerationError {
  constructor(msg = "Unsupported guide") {
    super(msg);
    this.name = "UnsupportedGuideError";
  }
}

export class UnsupportedLanguageOrLocaleError extends GenerationError {
  constructor(msg = "Unsupported language or locale") {
    super(msg);
    this.name = "UnsupportedLanguageOrLocaleError";
  }
}

export class DecodingFailureError extends GenerationError {
  constructor(msg = "Decoding failure") {
    super(msg);
    this.name = "DecodingFailureError";
  }
}

export class RateLimitedError extends GenerationError {
  constructor(msg = "Rate limited") {
    super(msg);
    this.name = "RateLimitedError";
  }
}

export class ConcurrentRequestsError extends GenerationError {
  constructor(msg = "Concurrent request already in progress") {
    super(msg);
    this.name = "ConcurrentRequestsError";
  }
}

export class RefusalError extends GenerationError {
  constructor(msg = "Model refused to generate content") {
    super(msg);
    this.name = "RefusalError";
  }
}

export class InvalidGenerationSchemaError extends GenerationError {
  constructor(msg = "Invalid generation schema") {
    super(msg);
    this.name = "InvalidGenerationSchemaError";
  }
}

/** The C bridge rejected an argument, such as a null pointer. */
export class InvalidArgumentError extends GenerationError {
  constructor(msg = "Invalid argument") {
    super(msg);
    this.name = "InvalidArgumentError";
  }
}

/** The model didn't finish in time. Only reported by hosts built with the macOS 27 SDK. */
export class TimeoutError extends GenerationError {
  constructor(msg = "Timed out") {
    super(msg);
    this.name = "TimeoutError";
  }
}

/**
 * The request needs a capability this model or this Mac doesn't have: for
 * example `reasoningLevel` on the on-device model, or a macOS 27 feature such
 * as `toolCallingMode` on macOS 26. When the Mac is too old, `requiredMacOS` is
 * the macOS version the feature needs.
 */
export class UnsupportedCapabilityError extends GenerationError {
  /** The macOS version the feature needs, when an older macOS is the reason. */
  readonly requiredMacOS?: number;

  constructor(msg = "Unsupported capability", options: { requiredMacOS?: number } = {}) {
    super(msg);
    this.name = "UnsupportedCapabilityError";
    if (options.requiredMacOS !== undefined) this.requiredMacOS = options.requiredMacOS;
  }
}

/**
 * The transcript contains content the model can't accept. Only reported by hosts
 * built with the macOS 27 SDK.
 */
export class UnsupportedTranscriptContentError extends GenerationError {
  constructor(msg = "Unsupported transcript content") {
    super(msg);
    this.name = "UnsupportedTranscriptContentError";
  }
}

/**
 * A request reached its `maximumToolCalls` limit. The call past the limit wasn't
 * run. With `toolCallingMode: "required"` the model keeps calling tools, so
 * this is how such a request ends unless a tool throws first.
 */
export class ToolCallLimitExceededError extends GenerationError {
  constructor(msg = "Tool call limit exceeded") {
    super(msg);
    this.name = "ToolCallLimitExceededError";
  }
}

/** Private Cloud Compute couldn't be reached. Retrying with the on-device model is reasonable. */
export class PrivateCloudComputeNetworkError extends GenerationError {
  constructor(msg = "Private Cloud Compute network failure") {
    super(msg);
    this.name = "PrivateCloudComputeNetworkError";
  }
}

/** The user used up their daily Private Cloud Compute quota. See `quotaUsage.resetDate`. */
export class PrivateCloudComputeQuotaExceededError extends GenerationError {
  constructor(msg = "Private Cloud Compute quota reached") {
    super(msg);
    this.name = "PrivateCloudComputeQuotaExceededError";
  }
}

/** Private Cloud Compute is temporarily unavailable. */
export class PrivateCloudComputeUnavailableError extends GenerationError {
  constructor(msg = "Private Cloud Compute is unavailable") {
    super(msg);
    this.name = "PrivateCloudComputeUnavailableError";
  }
}

/**
 * The host process isn't signed with `com.apple.developer.private-cloud-compute`.
 * `PrivateCloudComputeLanguageModel.isAvailable()` reports this up front as
 * `ENTITLEMENT_MISSING`.
 */
export class PrivateCloudComputeEntitlementError extends GenerationError {
  constructor(msg = "Missing the Private Cloud Compute entitlement") {
    super(msg);
    this.name = "PrivateCloudComputeEntitlementError";
  }
}

/**
 * An Apple Intelligence system service (the model manager or its safety
 * classifier) failed.
 * Detected in `statusToError()` when UNKNOWN_ERROR details contain
 * "SensitiveContentAnalysisML" or "ModelManagerError Code=1013".
 */
export class ServiceCrashedError extends GenerationError {
  constructor(detail?: string) {
    // launchctl can't restart these services while System Integrity Protection
    // is on, so the recovery is to wait, or log out or restart.
    const recovery =
      "The Apple Intelligence service has crashed. macOS restarts it, usually within a few " +
      "minutes; retry with a new session then. If it keeps failing, log out and back in, or " +
      "restart the Mac.";
    super(detail ? `${recovery}\n\nOriginal error: ${detail}` : recovery);
    this.name = "ServiceCrashedError";
  }
}

export class ToolCallError extends FoundationModelsError {
  constructor(
    public readonly toolName: string,
    public readonly cause: Error,
  ) {
    super(`Tool '${toolName}' failed: ${cause.message}`);
    this.name = "ToolCallError";
  }
}

export function statusToError(status: number, detail?: string | null): GenerationError {
  const suffix = detail ? `: ${detail}` : "";
  switch (status) {
    case GenerationErrorCode.EXCEEDED_CONTEXT_WINDOW_SIZE:
      return new ExceededContextWindowSizeError(`Context window size exceeded${suffix}`);
    case GenerationErrorCode.ASSETS_UNAVAILABLE:
      return new AssetsUnavailableError(`Assets unavailable${suffix}`);
    case GenerationErrorCode.GUARDRAIL_VIOLATION:
      return new GuardrailViolationError(`Guardrail violation${suffix}`);
    case GenerationErrorCode.UNSUPPORTED_GUIDE:
      return new UnsupportedGuideError(`Unsupported guide${suffix}`);
    case GenerationErrorCode.UNSUPPORTED_LANGUAGE_OR_LOCALE:
      return new UnsupportedLanguageOrLocaleError(`Unsupported language or locale${suffix}`);
    case GenerationErrorCode.DECODING_FAILURE:
      return new DecodingFailureError(`Decoding failure${suffix}`);
    case GenerationErrorCode.RATE_LIMITED:
      return new RateLimitedError(`Rate limited${suffix}`);
    case GenerationErrorCode.CONCURRENT_REQUESTS:
      return new ConcurrentRequestsError(`Concurrent request${suffix}`);
    case GenerationErrorCode.REFUSAL:
      return new RefusalError(`Model refused${suffix}`);
    case GenerationErrorCode.INVALID_SCHEMA:
      return new InvalidGenerationSchemaError(`Invalid schema${suffix}`);
    case GenerationErrorCode.INVALID_ARGUMENT:
      return new InvalidArgumentError(`Invalid argument${suffix}`);
    case GenerationErrorCode.TIMEOUT:
      return new TimeoutError(`Timed out${suffix}`);
    case GenerationErrorCode.UNSUPPORTED_CAPABILITY: {
      // The bridge reports a macOS 27 feature used on an older macOS as
      // "<feature> requires macOS <version> or later.".
      const required = /requires macOS (\d+)/.exec(detail ?? "");
      return new UnsupportedCapabilityError(
        `Unsupported capability${suffix}`,
        required ? { requiredMacOS: Number(required[1]) } : {},
      );
    }
    case GenerationErrorCode.UNSUPPORTED_TRANSCRIPT_CONTENT:
      return new UnsupportedTranscriptContentError(`Unsupported transcript content${suffix}`);
    case GenerationErrorCode.TOOL_CALL_LIMIT_EXCEEDED:
      return new ToolCallLimitExceededError(`Tool call limit exceeded${suffix}`);
    case GenerationErrorCode.PCC_NETWORK_FAILURE:
      return new PrivateCloudComputeNetworkError(`Private Cloud Compute network failure${suffix}`);
    case GenerationErrorCode.PCC_QUOTA_LIMIT_REACHED:
      return new PrivateCloudComputeQuotaExceededError(
        `Private Cloud Compute quota reached${suffix}`,
      );
    case GenerationErrorCode.PCC_SERVICE_UNAVAILABLE:
      return new PrivateCloudComputeUnavailableError(
        `Private Cloud Compute is unavailable${suffix}`,
      );
    case GenerationErrorCode.PCC_ENTITLEMENT_MISSING:
      return new PrivateCloudComputeEntitlementError(
        "This process isn't signed with the com.apple.developer.private-cloud-compute " +
          `entitlement, which Private Cloud Compute requires${suffix}`,
      );
    default:
      if (status === GenerationErrorCode.UNKNOWN_ERROR && detail) {
        if (
          detail.includes("SensitiveContentAnalysisML") ||
          detail.includes("ModelManagerError Code=1013")
        ) {
          return new ServiceCrashedError(detail);
        }
        if (detail.includes("ModelManagerError Code=1041")) {
          return new InvalidGenerationSchemaError(
            `The on-device model rejected the schema${suffix}`,
          );
        }
      }
      return new GenerationError(`Unknown error (code ${status})${suffix}`);
  }
}
