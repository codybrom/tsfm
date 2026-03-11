export const enum GenerationErrorCode {
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
  UNKNOWN_ERROR = 255,
}

export class FoundationModelsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundationModelsError";
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

/**
 * The Apple Intelligence service (`generativeexperiencesd`) has crashed.
 * Detected in `statusToError()` when UNKNOWN_ERROR details contain
 * "SensitiveContentAnalysisML" or "ModelManagerError Code=1013".
 */
export class ServiceCrashedError extends GenerationError {
  constructor(detail?: string) {
    const recovery =
      "The Apple Intelligence service has crashed. " +
      "Restart it by running: launchctl kickstart -k gui/$(id -u)/com.apple.generativeexperiencesd";
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
