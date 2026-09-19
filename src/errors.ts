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
  CANCELLED = 20,
  UNKNOWN_ERROR = 255,
}

export class FoundationModelsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundationModelsError";
  }
}

/**
 * Why a prompt attachment was refused: `not-found` (tsfm checked the path
 * before any native call), `unsupported-os` (macOS 26), `unknown`, or
 * `unsupported-sdk`, which a library built by tsfm never reports (see below).
 */
export type PromptAttachmentFailure =
  "not-found" | "unsupported-os" | "unsupported-sdk" | "unknown";

/**
 * Raised when an attachment cannot be added to a prompt.
 *
 * Attachments need macOS 27; on macOS 26 the reason is `unsupported-os`. A path
 * that isn't an existing file is `not-found`, thrown before native code runs.
 * tsfm's bridge always builds with the macOS 27 SDK, so `unsupported-sdk` is
 * never reported by it; the member stays for compatibility with 0.5, and for a
 * library built from upstream's bridge without that SDK.
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
 * as `toolCallingMode` on macOS 26. When the Mac is too old,
 * `minimumRequiredMacOS` is the macOS version the feature needs.
 */
export class UnsupportedCapabilityError extends GenerationError {
  /**
   * The macOS version the feature needs, when an older macOS is the reason:
   * `27` for macOS 27 features, or a point release such as `26.4` for token
   * counting.
   */
  readonly minimumRequiredMacOS?: number;

  constructor(msg = "Unsupported capability", options: { minimumRequiredMacOS?: number } = {}) {
    super(msg);
    this.name = "UnsupportedCapabilityError";
    if (options.minimumRequiredMacOS !== undefined)
      this.minimumRequiredMacOS = options.minimumRequiredMacOS;
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
 * The request was cancelled with `session.cancel()` (or its stream was
 * dropped) before it finished. Nothing went wrong on the model's side.
 */
export class CancelledError extends GenerationError {
  constructor(msg = "The request was cancelled") {
    super(msg);
    this.name = "CancelledError";
  }
}

/**
 * The session's transcript was changed while it was responding. Only reported
 * by hosts built with the macOS 27 SDK.
 */
export class TranscriptMutationWhileRespondingError extends GenerationError {
  constructor(msg = "The transcript was changed while the session was responding") {
    super(msg);
    this.name = "TranscriptMutationWhileRespondingError";
  }
}

/**
 * Throw this from a tool's `call()` to fail the whole request instead of
 * reporting the problem to the model. The request then rejects with
 * `RequestFailedByToolError`, which names the tool and carries this error as
 * its `cause`. Any other error a tool throws is sent back to the model as the
 * tool's output and generation continues.
 *
 * ```ts
 * async call(args) {
 *   const row = await db.find(args.value<string>("id"));
 *   if (!row) throw new FailRequestError("No such record", { cause: notFound });
 *   return row.summary;
 * }
 * ```
 */
export class FailRequestError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FailRequestError";
  }
}

/**
 * A tool failed the request by throwing `FailRequestError`. `toolName` and
 * `cause` (the `FailRequestError`) are set for requests made through a
 * session; with `toolCallingMode: "required"`, this is how a tool ends the
 * request.
 */
export class RequestFailedByToolError extends GenerationError {
  /** The tool that failed the request, once known. */
  toolName: string | null = null;
  /** The `FailRequestError` the tool threw, once known. */
  declare cause?: Error;

  constructor(msg = "A tool failed the request") {
    super(msg);
    this.name = "RequestFailedByToolError";
  }

  /** @internal Fills in what only the JavaScript side of the tool call knows. */
  _attach(toolName: string, cause: Error): void {
    this.toolName = toolName;
    this.cause = cause;
    this.message = `Tool '${toolName}' failed the request: ${cause.message}`;
  }
}

/**
 * The model manager refused the request because of the machine's state, most
 * often memory pressure: "Not executed due to current system state
 * ["CriticalMemoryPressure"], try again later". The model is installed and
 * `isAvailable()` still reports available; only running it is refused.
 *
 * Recorded behaviour while this lasts is in tests/fixtures/service-pressure/.
 */
export class SystemPressureError extends GenerationError {
  /** The state the model manager named, such as `CriticalMemoryPressure`. */
  readonly state?: string;

  constructor(state?: string, detail?: string) {
    const cause =
      state === "CriticalMemoryPressure"
        ? "the Mac is low on memory"
        : state === "Preempted"
          ? "another request took priority"
          : undefined;
    const message =
      `The system can't run the model right now` +
      (state ? ` (${state}${cause ? `: ${cause}` : ""})` : "") +
      ". It usually recovers on its own within a few minutes; retry then, " +
      "and free memory if it persists.";
    super(detail ? `${message}\n\nOriginal error: ${detail}` : message);
    this.name = "SystemPressureError";
    if (state) this.state = state;
  }
}

/**
 * An Apple Intelligence system service (the model manager or its safety
 * classifier) failed for a reason that isn't the machine's state.
 * Detected in `statusToError()` when UNKNOWN_ERROR details name
 * "SensitiveContentAnalysisML" without a model-manager system-state code.
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
      // The bridge reports a feature used on an older macOS as
      // "<feature> requires macOS <version> or later.". The version can be a
      // point release (token counting needs 26.4), so keep the minor part.
      const required = /requires macOS (\d+(?:\.\d+)?)/.exec(detail ?? "");
      return new UnsupportedCapabilityError(
        `Unsupported capability${suffix}`,
        required ? { minimumRequiredMacOS: Number(required[1]) } : {},
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
    case GenerationErrorCode.CANCELLED:
      // The bridge's detail is just "Operation cancelled" / "Stream cancelled",
      // which would read twice in one sentence.
      return new CancelledError(
        /^(Operation|Stream) cancelled\.?$/.test(detail?.trim() ?? "")
          ? "The request was cancelled"
          : `The request was cancelled${suffix}`,
      );
    default:
      if (status === GenerationErrorCode.UNKNOWN_ERROR && detail) {
        // 1013 is "not executed due to current system state". It reaches us
        // formatted two ways -- "ModelManagerError Code=1013" nested under the
        // safety classifier, and "ModelManagerError:1013" from a tool call --
        // so match the code rather than one spelling.
        if (/ModelManagerError[:\s](?:Code=)?1013/.test(detail)) {
          return new SystemPressureError(/\["([^"]+)"\]/.exec(detail)?.[1], detail);
        }
        if (detail.includes("SensitiveContentAnalysisML")) {
          return new ServiceCrashedError(detail);
        }
        // The model manager's other refusals, from its own message table (see
        // tests/fixtures/service-pressure/pressure.md). Each is transient and
        // arrives as an unmapped 255, so recognise it rather than reporting
        // "unknown error" for something the caller can act on.
        if (/rate limit exceeded/i.test(detail)) {
          return new RateLimitedError(`Rate limited${suffix}`);
        }
        if (/Canceled due to preemption/i.test(detail)) {
          return new SystemPressureError("Preempted", detail);
        }
        if (/(not available in|not found in) Model Catalog/i.test(detail)) {
          return new AssetsUnavailableError(`Assets unavailable${suffix}`);
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
