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
| `InvalidGenerationSchemaError` | 10 | Malformed schema |
| `InvalidArgumentError` | 11 | The native bridge rejected an argument, such as a null pointer |
| `TimeoutError` | 12 | The model didn't finish in time¹ |
| `UnsupportedCapabilityError` | 13 | The request needs a capability the model doesn't have¹ |
| `UnsupportedTranscriptContentError` | 14 | The transcript has content the model can't accept¹ |
| `ServiceCrashedError` | 255 | The Apple Intelligence service crashed; the message says how to restart it |
| `PromptAttachmentError` | — | Attachment refused; see `reason` |
| `ToolCallError` | — | Tool's `call()` threw |

¹ Only reported when the host process (Node, Electron, your app) was built with the macOS 27 SDK.
Older hosts receive the framework's legacy error type, which has no equivalent for these codes.

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
  ToolCallError,
} from "tsfm-sdk";

try {
  await session.respond("...");
} catch (e) {
  if (e instanceof ToolCallError) {
    // Tool handler threw
  } else if (e instanceof GenerationError) {
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
| `unsupported-os`, `unsupported-sdk` | Only from tsfm 0.x on macOS 26; kept in the type for compatibility |

See [prompt attachments](/api/language-model-session#prompt-attachments).
