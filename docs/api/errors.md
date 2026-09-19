# Errors

All SDK errors extend `FoundationModelsError`. Import specific error classes to handle them individually.

## Hierarchy

```text
FoundationModelsError
├── GenerationError
│   ├── ExceededContextWindowSizeError
│   ├── AssetsUnavailableError
│   ├── GuardrailViolationError
│   ├── UnsupportedGuideError
│   ├── UnsupportedLanguageOrLocaleError
│   ├── DecodingFailureError
│   ├── RateLimitedError
│   ├── ConcurrentRequestsError
│   ├── RefusalError
│   ├── InvalidGenerationSchemaError
│   ├── InvalidArgumentError
│   ├── TimeoutError
│   ├── UnsupportedCapabilityError
│   ├── UnsupportedTranscriptContentError
│   ├── ToolCallLimitExceededError
│   ├── PrivateCloudComputeNetworkError
│   ├── PrivateCloudComputeQuotaExceededError
│   ├── PrivateCloudComputeUnavailableError
│   ├── PrivateCloudComputeEntitlementError
│   └── ServiceCrashedError
├── PromptAttachmentError
└── ToolCallError
```

## Error Reference

| Error | Code | When |
| --- | --- | --- |
| `ExceededContextWindowSizeError` | 1 | Session history too long |
| `AssetsUnavailableError` | 2 | Model not downloaded |
| `GuardrailViolationError` | 3 | Content policy violation |
| `UnsupportedGuideError` | 4 | Unsupported generation guide |
| `UnsupportedLanguageOrLocaleError` | 5 | Language not supported |
| `DecodingFailureError` | 6 | Structured output parse failure |
| `RateLimitedError` | 7 | Too many requests |
| `ConcurrentRequestsError` | 8 | Session already responding |
| `RefusalError` | 9 | Model declined to answer |
| `InvalidGenerationSchemaError` | 10 | Malformed schema, including an undefined `$ref` or a JSON schema nested more than 128 levels deep |
| `InvalidArgumentError` | 11 | The native bridge rejected an argument, such as a null pointer |
| `TimeoutError` | 12 | The model didn't finish in time¹ |
| `UnsupportedCapabilityError` | 13 | The request needs a capability the model or this Mac doesn't have, such as a macOS 27 feature on macOS 26 (see `requiredMacOS`)² |
| `UnsupportedTranscriptContentError` | 14 | The transcript has content the model can't accept¹ |
| `ToolCallLimitExceededError` | 15 | A request reached `maximumToolCalls`; the extra call wasn't run |
| `PrivateCloudComputeNetworkError` | 16 | [PCC](/guide/private-cloud-compute) couldn't be reached |
| `PrivateCloudComputeQuotaExceededError` | 17 | The user's daily PCC quota is used up |
| `PrivateCloudComputeUnavailableError` | 18 | PCC is temporarily unavailable |
| `PrivateCloudComputeEntitlementError` | 19 | The host isn't signed with the PCC entitlement |
| `ServiceCrashedError` | 255 | An Apple Intelligence system service crashed; wait for macOS to restart it, then retry with a new session |
| `PromptAttachmentError` | — | Attachment refused; see `reason` |
| `ToolCallError` | — | Tool's `call()` threw. Not thrown to your `respond()`: its message goes back to the model as the tool's result |

¹ Only reported when the host process (Node, Electron, your app) was built with the macOS 27 SDK.
Older hosts receive the framework's legacy error type, which has no equivalent for these codes.

² When a macOS 27 feature is used on macOS 26, tsfm throws this before the request, on any host, and
sets `requiredMacOS` to `27`. Token counting needs macOS 26.4, so on 26.0–26.3 `requiredMacOS` is `26.4`:

```ts
try {
  await session.respond(prompt, { options: { toolCallingMode: "required" } });
} catch (err) {
  if (err instanceof UnsupportedCapabilityError && err.requiredMacOS) {
    // Fall back, or tell the user this needs macOS 27.
  }
}
```

## GenerationErrorCode

Enum mapping status codes to error types:

```ts
enum GenerationErrorCode {
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
```

## Usage

```ts
import {
  FoundationModelsError,
  GenerationError,
  ExceededContextWindowSizeError,
  GuardrailViolationError,
} from "tsfm-sdk";

try {
  await session.respond("...");
} catch (e) {
  if (e instanceof GenerationError) {
    // Any generation error
  } else if (e instanceof FoundationModelsError) {
    // Any SDK error
  }
}
```

## PromptAttachmentError

Thrown when an attachment cannot be added to a prompt. Carries a `reason`:

| Reason | Meaning |
| --- | --- |
| `unknown` | The bridge refused the attachment without saying why |
| `unsupported-os` | Attachments need macOS 27, and this Mac runs macOS 26 |
| `unsupported-sdk` | The native library was built without the macOS 27 SDK (never the bundled one) |

See [prompt attachments](/api/language-model-session#prompt-attachments).
