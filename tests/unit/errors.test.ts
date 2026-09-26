import { describe, it, expect } from "vitest";
import { recordToolFailure } from "../../src/tool-budget.js";
import {
  statusToError,
  GenerationErrorCode,
  ExceededContextWindowSizeError,
  AssetsUnavailableError,
  GuardrailViolationError,
  UnsupportedGuideError,
  UnsupportedLanguageOrLocaleError,
  DecodingFailureError,
  RateLimitedError,
  ConcurrentRequestsError,
  RefusalError,
  InvalidGenerationSchemaError,
  InvalidArgumentError,
  TimeoutError,
  UnsupportedCapabilityError,
  UnsupportedTranscriptContentError,
  ToolCallLimitExceededError,
  PrivateCloudComputeNetworkError,
  PrivateCloudComputeQuotaExceededError,
  PrivateCloudComputeUnavailableError,
  PrivateCloudComputeEntitlementError,
  ServiceCrashedError,
  SystemPressureError,
  CancelledError,
  TranscriptMutationWhileRespondingError,
  FailRequestError,
  RequestFailedByToolError,
  GenerationError,
  FoundationModelsError,
  ToolCallError,
} from "../../src/errors.js";

describe("statusToError", () => {
  it("maps EXCEEDED_CONTEXT_WINDOW_SIZE to ExceededContextWindowSizeError", () => {
    const err = statusToError(GenerationErrorCode.EXCEEDED_CONTEXT_WINDOW_SIZE);
    expect(err).toBeInstanceOf(ExceededContextWindowSizeError);
    expect(err.message).toBe("Context window size exceeded");
  });

  it("maps ASSETS_UNAVAILABLE to AssetsUnavailableError", () => {
    const err = statusToError(GenerationErrorCode.ASSETS_UNAVAILABLE);
    expect(err).toBeInstanceOf(AssetsUnavailableError);
    expect(err.message).toBe("Assets unavailable");
  });

  it("maps GUARDRAIL_VIOLATION to GuardrailViolationError", () => {
    const err = statusToError(GenerationErrorCode.GUARDRAIL_VIOLATION);
    expect(err).toBeInstanceOf(GuardrailViolationError);
    expect(err.message).toBe("Guardrail violation");
  });

  it("maps UNSUPPORTED_GUIDE to UnsupportedGuideError", () => {
    const err = statusToError(GenerationErrorCode.UNSUPPORTED_GUIDE);
    expect(err).toBeInstanceOf(UnsupportedGuideError);
    expect(err.message).toBe("Unsupported guide");
  });

  it("maps UNSUPPORTED_LANGUAGE_OR_LOCALE to UnsupportedLanguageOrLocaleError", () => {
    const err = statusToError(GenerationErrorCode.UNSUPPORTED_LANGUAGE_OR_LOCALE);
    expect(err).toBeInstanceOf(UnsupportedLanguageOrLocaleError);
    expect(err.message).toBe("Unsupported language or locale");
  });

  it("maps DECODING_FAILURE to DecodingFailureError", () => {
    const err = statusToError(GenerationErrorCode.DECODING_FAILURE);
    expect(err).toBeInstanceOf(DecodingFailureError);
    expect(err.message).toBe("Decoding failure");
  });

  it("maps RATE_LIMITED to RateLimitedError", () => {
    const err = statusToError(GenerationErrorCode.RATE_LIMITED);
    expect(err).toBeInstanceOf(RateLimitedError);
    expect(err.message).toBe("Rate limited");
  });

  it("reads the rate limit's reset date from the bridge's marker", () => {
    const err = statusToError(
      GenerationErrorCode.RATE_LIMITED,
      "[tsfm-reset-date:2026-09-22T18:30:00Z] Too many requests",
    );
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).resetDate).toEqual(new Date("2026-09-22T18:30:00Z"));
    expect(err.message).toBe("Rate limited: Too many requests");
  });

  it("leaves resetDate undefined when the framework gives none, or an unreadable one", () => {
    const plain = statusToError(GenerationErrorCode.RATE_LIMITED, "Too many");
    expect((plain as RateLimitedError).resetDate).toBeUndefined();
    const err = statusToError(GenerationErrorCode.RATE_LIMITED, "[tsfm-reset-date:soon] Too many");
    expect((err as RateLimitedError).resetDate).toBeUndefined();
    expect(err.message).toBe("Rate limited: Too many");
  });

  it("maps CONCURRENT_REQUESTS to ConcurrentRequestsError", () => {
    const err = statusToError(GenerationErrorCode.CONCURRENT_REQUESTS);
    expect(err).toBeInstanceOf(ConcurrentRequestsError);
    expect(err.message).toBe("Concurrent request");
  });

  it("maps REFUSAL to RefusalError", () => {
    const err = statusToError(GenerationErrorCode.REFUSAL);
    expect(err).toBeInstanceOf(RefusalError);
    expect(err.message).toBe("Model refused");
  });

  it("maps INVALID_SCHEMA to InvalidGenerationSchemaError", () => {
    const err = statusToError(GenerationErrorCode.INVALID_SCHEMA);
    expect(err).toBeInstanceOf(InvalidGenerationSchemaError);
    expect(err.message).toBe("Invalid schema");
  });

  it("INVALID_SCHEMA error is catchable as GenerationError", () => {
    // Regression test: InvalidGenerationSchemaError must extend GenerationError
    // so callers catching GenerationError receive schema validation failures.
    const err = statusToError(GenerationErrorCode.INVALID_SCHEMA);
    expect(err).toBeInstanceOf(GenerationError);
  });

  it.each([
    [GenerationErrorCode.INVALID_ARGUMENT, InvalidArgumentError, "Invalid argument"],
    [GenerationErrorCode.TIMEOUT, TimeoutError, "Timed out"],
    [
      GenerationErrorCode.UNSUPPORTED_CAPABILITY,
      UnsupportedCapabilityError,
      "Unsupported capability",
    ],
    [
      GenerationErrorCode.UNSUPPORTED_TRANSCRIPT_CONTENT,
      UnsupportedTranscriptContentError,
      "Unsupported transcript content",
    ],
    [
      GenerationErrorCode.TOOL_CALL_LIMIT_EXCEEDED,
      ToolCallLimitExceededError,
      "Tool call limit exceeded",
    ],
    [
      GenerationErrorCode.PCC_NETWORK_FAILURE,
      PrivateCloudComputeNetworkError,
      "Private Cloud Compute network failure",
    ],
    [
      GenerationErrorCode.PCC_QUOTA_LIMIT_REACHED,
      PrivateCloudComputeQuotaExceededError,
      "Private Cloud Compute quota reached",
    ],
    [
      GenerationErrorCode.PCC_SERVICE_UNAVAILABLE,
      PrivateCloudComputeUnavailableError,
      "Private Cloud Compute is unavailable",
    ],
  ])("maps code %i to its GenerationError subclass", (code, type, message) => {
    const err = statusToError(code);
    expect(err).toBeInstanceOf(type);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.message).toBe(message);
  });

  it("maps TRANSCRIPT_MUTATION_WHILE_RESPONDING to its error, a GenerationError", () => {
    const err = statusToError(GenerationErrorCode.TRANSCRIPT_MUTATION_WHILE_RESPONDING, "edited");
    expect(err).toBeInstanceOf(TranscriptMutationWhileRespondingError);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.message).toBe("The transcript was changed while the session was responding: edited");
    expect(GenerationErrorCode.TRANSCRIPT_MUTATION_WHILE_RESPONDING).toBe(21);
  });

  it("maps REQUEST_FAILED_BY_TOOL to RequestFailedByToolError, with no tool yet", () => {
    const err = statusToError(GenerationErrorCode.REQUEST_FAILED_BY_TOOL, "no such record");
    expect(err).toBeInstanceOf(RequestFailedByToolError);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.message).toBe("A tool failed the request: no such record");
    expect((err as RequestFailedByToolError).toolName).toBeNull();
    expect(GenerationErrorCode.REQUEST_FAILED_BY_TOOL).toBe(22);
  });

  it("RequestFailedByToolError names the tool and carries the cause once attached", () => {
    const cause = new FailRequestError("no such record", { cause: new Error("404") });
    expect(cause.name).toBe("FailRequestError");
    expect((cause.cause as Error).message).toBe("404");
    const err = statusToError(GenerationErrorCode.REQUEST_FAILED_BY_TOOL, "no such record");
    (err as RequestFailedByToolError)._attach("lookup", cause);
    expect((err as RequestFailedByToolError).toolName).toBe("lookup");
    expect(err.cause).toBe(cause);
    expect(err.message).toBe("Tool 'lookup' failed the request: no such record");
  });

  it.each([false, true])(
    "hides the failure marker without a matching budget (JSON: %s)",
    (json) => {
      const failure = new FailRequestError('No record "alpha"\nTry again');
      const wire = recordToolFailure([], "lookup", failure);
      const detail = json ? JSON.stringify(wire) : wire;
      const error = statusToError(GenerationErrorCode.REQUEST_FAILED_BY_TOOL, detail);
      expect(error).toBeInstanceOf(RequestFailedByToolError);
      expect(error.message).toBe(
        `A tool failed the request: ${json ? JSON.stringify(failure.message) : failure.message}`,
      );
      expect((error as RequestFailedByToolError)._failureId).toBeTruthy();
      expect((error as RequestFailedByToolError).toolName).toBeNull();
      expect(error.cause).toBeUndefined();
    },
  );

  it.each([
    [
      "a tool call",
      'Error ModelManagerServices.ModelManagerError:1013 - Not executed due to current system state ["CriticalMemoryPressure"], try again later',
      "CriticalMemoryPressure",
    ],
    [
      "the safety classifier",
      'Error Domain=com.apple.SensitiveContentAnalysisML Code=15 UserInfo={NSMultipleUnderlyingErrorsKey=("Error Domain=ModelManagerServices.ModelManagerError Code=1013")}',
      undefined,
    ],
  ])("maps the model manager's 1013 from %s to SystemPressureError", (_name, detail, state) => {
    // The same refusal reaches us formatted two ways; see
    // tests/fixtures/service-pressure/.
    const err = statusToError(GenerationErrorCode.UNKNOWN_ERROR, detail);
    expect(err).toBeInstanceOf(SystemPressureError);
    expect((err as SystemPressureError).state).toBe(state);
    expect(err.message).toContain("can't run the model right now");
    expect(err.message).toContain(detail);
  });

  // Messages taken verbatim from ModelManagerServices' own table; see
  // tests/fixtures/service-pressure/pressure.md.
  it.each([
    ["Client rate limit exceeded, try again later", RateLimitedError],
    ["Canceled due to preemption, try again", SystemPressureError],
    ["Asset com.apple.fm.language is not available in Model Catalog", AssetsUnavailableError],
    ["Asset com.apple.fm.language not found in Model Catalog", AssetsUnavailableError],
  ])("recognises the model manager's %j instead of reporting an unknown error", (detail, type) => {
    const err = statusToError(GenerationErrorCode.UNKNOWN_ERROR, detail);
    expect(err).toBeInstanceOf(type);
    expect(err.message).not.toContain("Unknown error");
  });

  it("names preemption as the state when the model manager yields to another request", () => {
    const err = statusToError(
      GenerationErrorCode.UNKNOWN_ERROR,
      "Canceled due to preemption, try again",
    );
    expect((err as SystemPressureError).state).toBe("Preempted");
    expect(err.message).toContain("another request took priority");
  });

  it("still reports a classifier failure with no system state as a crash", () => {
    const err = statusToError(
      GenerationErrorCode.UNKNOWN_ERROR,
      'Error Domain=com.apple.SensitiveContentAnalysisML Code=15 "(null)"',
    );
    expect(err).toBeInstanceOf(ServiceCrashedError);
    expect(err).not.toBeInstanceOf(SystemPressureError);
  });

  it("maps CANCELLED to CancelledError, a GenerationError", () => {
    const err = statusToError(GenerationErrorCode.CANCELLED, "Operation cancelled");
    expect(err).toBeInstanceOf(CancelledError);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.name).toBe("CancelledError");
    expect(err.message).toBe("The request was cancelled");
    expect(GenerationErrorCode.CANCELLED).toBe(20);
  });

  it("keeps a cancellation detail that says more than the bridge's own wording", () => {
    const err = statusToError(GenerationErrorCode.CANCELLED, "the host went away");
    expect(err.message).toBe("The request was cancelled: the host went away");
  });

  it("keeps the point release in minimumRequiredMacOS, as token counting needs 26.4", () => {
    const err = statusToError(
      GenerationErrorCode.UNSUPPORTED_CAPABILITY,
      "Token counting requires macOS 26.4 or later.",
    );
    expect(err).toBeInstanceOf(UnsupportedCapabilityError);
    expect((err as UnsupportedCapabilityError).minimumRequiredMacOS).toBe(26.4);
  });

  it("maps PCC_ENTITLEMENT_MISSING to an error naming the entitlement", () => {
    const err = statusToError(GenerationErrorCode.PCC_ENTITLEMENT_MISSING);
    expect(err).toBeInstanceOf(PrivateCloudComputeEntitlementError);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.message).toMatch(/com\.apple\.developer\.private-cloud-compute/);
  });

  it("maps unknown code to GenerationError", () => {
    const err = statusToError(999);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err.message).toBe("Unknown error (code 999)");
  });

  it("appends detail suffix when provided", () => {
    const err = statusToError(GenerationErrorCode.RATE_LIMITED, "try again later");
    expect(err.message).toBe("Rate limited: try again later");
  });

  it("does not append suffix when detail is null", () => {
    const err = statusToError(GenerationErrorCode.RATE_LIMITED, null);
    expect(err.message).toBe("Rate limited");
  });

  it("does not append suffix when detail is undefined", () => {
    const err = statusToError(GenerationErrorCode.RATE_LIMITED, undefined);
    expect(err.message).toBe("Rate limited");
  });

  it("does not append suffix when detail is empty string", () => {
    const err = statusToError(GenerationErrorCode.RATE_LIMITED, "");
    expect(err.message).toBe("Rate limited");
  });

  it("appends detail to unknown error codes", () => {
    const err = statusToError(999, "something went wrong");
    expect(err.message).toBe("Unknown error (code 999): something went wrong");
  });

  it("maps code 255 with SensitiveContentAnalysisML to ServiceCrashedError", () => {
    const detail =
      "Error FoundationModels.LanguageModelSession.GenerationError:-1 - UserInfo: " +
      '["NSMultipleUnderlyingErrorsKey": [Error Domain=com.apple.SensitiveContentAnalysisML Code=15]]';
    const err = statusToError(255, detail);
    expect(err).toBeInstanceOf(ServiceCrashedError);
    expect(err.message).toContain("Apple Intelligence service has crashed");
    expect(err.message).toContain("log out and back in");
    expect(err.message).toContain(detail);
  });

  it("maps code 255 with ModelManagerError Code=1013 to SystemPressureError", () => {
    const detail = "ModelManagerServices.ModelManagerError Code=1013";
    const err = statusToError(255, detail);
    expect(err).toBeInstanceOf(SystemPressureError);
  });

  it("leaves 1008, the model manager's unclassified wrapper, as a generic GenerationError", () => {
    const detail = "ModelManagerServices.ModelManagerError error 1008.";
    const err = statusToError(255, detail);
    expect(err.constructor).toBe(GenerationError);
    expect(err.message).toContain(detail);
  });

  it("maps the model manager's insufficient-resources 1012 to SystemPressureError", () => {
    const detail = "ModelManagerServices.ModelManagerError error 1012.";
    const err = statusToError(255, detail);
    expect(err).toBeInstanceOf(SystemPressureError);
    expect((err as SystemPressureError).state).toBeUndefined();
    expect(err.message).toContain(`Original error: ${detail}`);
  });

  it("maps the model manager's inference-provider crash 1032 to ServiceCrashedError", () => {
    const err = statusToError(255, "ModelManagerServices.ModelManagerError Code=1032");
    expect(err).toBeInstanceOf(ServiceCrashedError);
  });

  it.each([["ModelManagerServices.ModelManagerError error 1013.", SystemPressureError]])(
    "recognizes %s whatever the spelling",
    (detail, type) => {
      expect(statusToError(255, detail)).toBeInstanceOf(type);
    },
  );

  it("doesn't mistake a longer code for a known one", () => {
    const err = statusToError(255, "ModelManagerServices.ModelManagerError error 10080.");
    expect(err).not.toBeInstanceOf(SystemPressureError);
  });

  it.each([
    "ModelManagerServices.ModelManagerError Code=1041 - schema rejected",
    "ModelManagerServices.ModelManagerError error 1041.",
    "ModelManagerServices.ModelManagerError:1041",
  ])("leaves the model manager's ipcError 1041 generic: %s", (detail) => {
    // 1041 is a failure to reach the model manager, so it must not read as a
    // rejected schema, which would send the caller to rewrite a correct one.
    const err = statusToError(255, detail);
    expect(err).toBeInstanceOf(GenerationError);
    expect(err).not.toBeInstanceOf(InvalidGenerationSchemaError);
    expect(err.message).toContain(detail);
  });

  it("maps code 255 without crash signature to generic GenerationError", () => {
    const err = statusToError(255, "some other error");
    expect(err).not.toBeInstanceOf(ServiceCrashedError);
    expect(err).toBeInstanceOf(GenerationError);
  });
});

describe("GenerationErrorCode", () => {
  it("exists at runtime, with reverse mappings", () => {
    // A const enum would be erased at compile time and leave nothing here.
    expect(GenerationErrorCode.TIMEOUT).toBe(12);
    expect(GenerationErrorCode[12]).toBe("TIMEOUT");
    expect(Object.keys(GenerationErrorCode)).toContain("UNSUPPORTED_TRANSCRIPT_CONTENT");
  });
});

describe("error hierarchy", () => {
  it("GenerationError extends FoundationModelsError", () => {
    const err = new GenerationError("test");
    expect(err).toBeInstanceOf(FoundationModelsError);
    expect(err).toBeInstanceOf(Error);
  });

  it("specific errors extend GenerationError", () => {
    expect(new ExceededContextWindowSizeError()).toBeInstanceOf(GenerationError);
    expect(new AssetsUnavailableError()).toBeInstanceOf(GenerationError);
    expect(new GuardrailViolationError()).toBeInstanceOf(GenerationError);
    expect(new UnsupportedGuideError()).toBeInstanceOf(GenerationError);
    expect(new UnsupportedLanguageOrLocaleError()).toBeInstanceOf(GenerationError);
    expect(new DecodingFailureError()).toBeInstanceOf(GenerationError);
    expect(new RateLimitedError()).toBeInstanceOf(GenerationError);
    expect(new ConcurrentRequestsError()).toBeInstanceOf(GenerationError);
    expect(new RefusalError()).toBeInstanceOf(GenerationError);
    expect(new InvalidGenerationSchemaError()).toBeInstanceOf(GenerationError);
    expect(new ServiceCrashedError()).toBeInstanceOf(GenerationError);
  });

  it("InvalidGenerationSchemaError extends GenerationError and FoundationModelsError", () => {
    const err = new InvalidGenerationSchemaError();
    expect(err).toBeInstanceOf(GenerationError);
    expect(err).toBeInstanceOf(FoundationModelsError);
  });

  it("ToolCallError captures tool name and cause", () => {
    const cause = new Error("boom");
    const err = new ToolCallError("myTool", cause);
    expect(err.toolName).toBe("myTool");
    expect(err.cause).toBe(cause);
    expect(err.message).toBe("Tool 'myTool' failed: boom");
    expect(err).toBeInstanceOf(FoundationModelsError);
  });

  it("ToolCallError does not extend GenerationError", () => {
    const err = new ToolCallError("t", new Error("x"));
    expect(err).not.toBeInstanceOf(GenerationError);
  });

  it("error names are set correctly", () => {
    expect(new FoundationModelsError("x").name).toBe("FoundationModelsError");
    expect(new GenerationError("x").name).toBe("GenerationError");
    expect(new ExceededContextWindowSizeError().name).toBe("ExceededContextWindowSizeError");
    expect(new AssetsUnavailableError().name).toBe("AssetsUnavailableError");
    expect(new GuardrailViolationError().name).toBe("GuardrailViolationError");
    expect(new UnsupportedGuideError().name).toBe("UnsupportedGuideError");
    expect(new UnsupportedLanguageOrLocaleError().name).toBe("UnsupportedLanguageOrLocaleError");
    expect(new DecodingFailureError().name).toBe("DecodingFailureError");
    expect(new RateLimitedError().name).toBe("RateLimitedError");
    expect(new ConcurrentRequestsError().name).toBe("ConcurrentRequestsError");
    expect(new RefusalError().name).toBe("RefusalError");
    expect(new InvalidGenerationSchemaError().name).toBe("InvalidGenerationSchemaError");
    expect(new ToolCallError("t", new Error("x")).name).toBe("ToolCallError");
    expect(new ServiceCrashedError().name).toBe("ServiceCrashedError");
  });

  it("ServiceCrashedError includes recovery instructions", () => {
    const err = new ServiceCrashedError();
    expect(err.message).toContain("Retry with a new session");
    expect(err.message).toContain("log out and back in");
    expect(err.message).not.toContain("launchctl");
  });

  it("ServiceCrashedError includes original error detail when provided", () => {
    const err = new ServiceCrashedError("SensitiveContentAnalysisML Code=15");
    expect(err.message).toContain("SensitiveContentAnalysisML Code=15");
    expect(err.message).toContain("log out and back in");
  });

  it("errors have default messages when constructed without arguments", () => {
    expect(new ExceededContextWindowSizeError().message).toBe("Context window size exceeded");
    expect(new AssetsUnavailableError().message).toBe("Required assets unavailable");
    expect(new GuardrailViolationError().message).toBe("Guardrail violation");
    expect(new UnsupportedGuideError().message).toBe("Unsupported guide");
    expect(new UnsupportedLanguageOrLocaleError().message).toBe("Unsupported language or locale");
    expect(new DecodingFailureError().message).toBe("Decoding failure");
    expect(new RateLimitedError().message).toBe("Rate limited");
    expect(new ConcurrentRequestsError().message).toBe("Concurrent request already in progress");
    expect(new RefusalError().message).toBe("Model refused to generate content");
    expect(new InvalidGenerationSchemaError().message).toBe("Invalid generation schema");
  });
});
