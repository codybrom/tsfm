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
│   └── InvalidGenerationSchemaError
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
| `ToolCallError` | — | Tool's `call()` threw |

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
