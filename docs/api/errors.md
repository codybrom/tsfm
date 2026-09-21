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
│   ├── CancelledError
│   ├── TranscriptMutationWhileRespondingError
│   ├── RequestFailedByToolError
│   ├── ServiceCrashedError
│   └── SystemPressureError
├── PromptAttachmentError
└── ToolCallError
```

`FailRequestError` extends plain `Error`, not `FoundationModelsError`: it's what
a tool throws, not what tsfm throws (see below).

## Error Reference

| Error | Code | When |
| --- | --- | --- |
| `ExceededContextWindowSizeError` | 1 | Session history too long |
| `AssetsUnavailableError` | 2 or 255 | Model not downloaded or ready. Private ModelManager error 1008 maps here even when availability reports success. |
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
| `UnsupportedCapabilityError` | 13 | The request needs a capability the model or this Mac doesn't have, such as a macOS 27 feature on macOS 26 (see `minimumRequiredMacOS`)² |
| `UnsupportedTranscriptContentError` | 14 | The transcript has content the model can't accept¹ |
| `ToolCallLimitExceededError` | 15 | A request reached `maximumToolCalls`; the extra call wasn't run |
| `PrivateCloudComputeNetworkError` | 16 | [PCC](/guide/private-cloud-compute) couldn't be reached |
| `PrivateCloudComputeQuotaExceededError` | 17 | The user's daily PCC quota is used up |
| `PrivateCloudComputeUnavailableError` | 18 | PCC is temporarily unavailable |
| `PrivateCloudComputeEntitlementError` | 19 | The host isn't signed with the PCC entitlement |
| `CancelledError` | 20 | The request was stopped by `session.cancel()`, or its stream was dropped, before it finished |
| `TranscriptMutationWhileRespondingError` | 21 | The transcript was changed while the session was responding¹ |
| `RequestFailedByToolError` | 22 | A tool threw `FailRequestError`. `toolName` says which, and `cause` is that error. This is also how a tool ends a `toolCallingMode: "required"` request |
| `ServiceCrashedError` | 255 | An Apple Intelligence system service failed for a reason other than the machine's state; wait for macOS to restart it, then retry with a new session |
| `SystemPressureError` | 255 | The system refused to run the model because of its current state, usually memory pressure. `state` names it. Transient — retry in a few minutes |
| `PromptAttachmentError` | — | Attachment refused; see `reason` |
| `ToolCallError` | — | Tool's `call()` threw. Not thrown to your `respond()`: its message goes back to the model as the tool's result |
| `FailRequestError` | — | Thrown by a tool's `call()`, on purpose, to fail the request instead of answering the model. `respond()` then rejects with `RequestFailedByToolError` |

¹ Only reported when the host process (Node, Electron, your app) was built with the macOS 27 SDK.
Older hosts receive the framework's legacy error type, which has no equivalent for these codes.

² When a macOS 27 feature is used on macOS 26, tsfm throws this before the request, on any host, and
sets `minimumRequiredMacOS` to `27`. Token counting needs macOS 26.4, so on 26.0–26.3 `minimumRequiredMacOS` is `26.4`:

```ts
try {
  await session.respond(prompt, { options: { toolCallingMode: "required" } });
} catch (err) {
  if (err instanceof UnsupportedCapabilityError && err.minimumRequiredMacOS) {
    // Fall back, or tell the user this needs macOS 27.
  }
}
```

## Tool failures

Throw `FailRequestError` from `Tool.call()` to stop a text, structured or streaming
request. A synchronous throw and a rejected Promise both produce
`RequestFailedByToolError`. Its `toolName` and `cause` belong to the invocation
that failed this request, including when concurrent sessions share the tool and
their errors have identical messages. The `cause` is the original error object,
so its own `cause` is preserved too. See [Failing the request](/api/tool#failing-the-request).

Other errors from `call()` are returned to the model as tool output, and generation
continues.

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
  CANCELLED = 20,
  TRANSCRIPT_MUTATION_WHILE_RESPONDING = 21,
  REQUEST_FAILED_BY_TOOL = 22,
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
| `not-found` | The path isn't an existing file. Checked before any native call, so nothing was sent |
| `unknown` | The bridge refused the attachment without saying why |
| `unsupported-os` | Attachments need macOS 27, and this Mac runs macOS 26 |
| `unsupported-sdk` | Never reported by a library tsfm built: its bridge always uses the macOS 27 SDK. Kept from 0.5 for a library built from upstream's bridge without that SDK |

See [prompt attachments](/api/language-model-session#prompt-attachments).
