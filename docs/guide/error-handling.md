# Error Handling

All SDK errors extend `FoundationModelsError`. Generation-specific errors extend `GenerationError`, which itself extends `FoundationModelsError`. TSFM also adds `ServiceCrashedError`, `SystemPressureError` and `ToolCallError`.

::: info
The **Swift** equivalents are [`LanguageModelError`](https://developer.apple.com/documentation/foundationmodels/languagemodelerror) (macOS 27) together with [`LanguageModelSession.Error`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/error), [`SystemLanguageModel.Error`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/error) and [`PrivateCloudComputeLanguageModel.Error`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/error). The older `LanguageModelSession.GenerationError` is deprecated in macOS 27. Hosts built against older SDKs still receive it, and tsfm maps both to the same classes.
:::

## Error Hierarchy

::: info FoundationModelsError
All errors inherit from `FoundationModelsError`.

**GenerationError**: errors during generation:

- `ExceededContextWindowSizeError`
- `AssetsUnavailableError`
- `GuardrailViolationError`
- `UnsupportedGuideError`
- `UnsupportedLanguageOrLocaleError`
- `DecodingFailureError`
- `RateLimitedError`
- `ConcurrentRequestsError`
- `RefusalError`
- `InvalidGenerationSchemaError`
- `ServiceCrashedError`
- `SystemPressureError`

**ToolCallError**: a tool's `call()` method threw
:::

## Catching Errors

```ts
import {
  ExceededContextWindowSizeError,
  GuardrailViolationError,
  RateLimitedError,
} from "tsfm-sdk";

try {
  await session.respond("...");
} catch (e) {
  if (e instanceof ExceededContextWindowSizeError) {
    // Start a new session — context window is full
  } else if (e instanceof GuardrailViolationError) {
    // Content policy was triggered
  } else if (e instanceof RateLimitedError) {
    // Too many requests — wait and retry
  }
}
```

## Error Reference

### ExceededContextWindowSizeError

The session's accumulated context has exceeded the model's limit. All content (instructions, prompts, responses, tool schemas, tool calls, and tool output) share one context window. Long conversations or large tool outputs will eventually hit this. Dispose the session and start a new one, optionally seeding it with a trimmed [transcript](/guide/transcripts). Apple recommends splitting large tasks across multiple sessions.

### AssetsUnavailableError

The on-device model files haven't finished downloading. This typically happens right after enabling Apple Intelligence or after a macOS update. Call `model.waitUntilAvailable()` before creating a session. It will resolve once the assets are ready.

### GuardrailViolationError

The model's safety [guardrails](/guide/model-configuration#guardrails) flagged the prompt or the generated response. With `DEFAULT` guardrails, this means unsafe content was detected and blocked. With `PERMISSIVE_CONTENT_TRANSFORMATIONS`, you should see this less often as the model will attempt to transform content instead of rejecting it. Either way, you should attempt to catch this and surface a user-friendly message.

### UnsupportedGuideError

A `GenerationGuide` on one of your schema properties isn't supported by the current model version. This can happen if you use a guide that was introduced in a newer OS version than the user is running. Check your guide types against the [guides reference](/guide/structured-output#generation-guides).

### UnsupportedLanguageOrLocaleError

The system locale or the language of the prompt isn't supported by the on-device model. Foundation Models supports a subset of languages. This error means you've hit one it can't handle.

### DecodingFailureError

The model generated output during structured generation, but it couldn't be decoded into your schema. This can happen with complex or deeply nested schemas. Simplify the schema or add more descriptive property descriptions to guide the model.

### RateLimitedError

Too many requests to the on-device model in a short window. This is an OS-level rate limit, not a network API limit. On macOS 26 Apple scopes it to apps running in the background that exceed a system rate limit while macOS 27 generalizes it. Apple advises using the non-streaming `respond()` rather than streaming when running in the background (an important difference for Node-based daemons). On macOS 27 the framework's error can carry a reset date, which tsfm exposes as `err.resetDate`. Wait until then before retrying. Without one, back off and retry after a short delay.

### ConcurrentRequestsError

Foundation Models says not to call `respond()` on a session while `isResponding` is `true`. Doing so in Swift throws this. tsfm queues requests on a session and runs them one at a time instead, so a second `respond()` waits rather than failing, and this error is nearly unreachable through tsfm. If you see it, a session is being driven from outside tsfm's queue (for example through the transcript of a session that's still responding).

### RefusalError

The model declined to generate a response. This is distinct from `GuardrailViolationError`: refusal means the model chose not to answer (e.g., the prompt asks for something outside its capabilities), not that a content filter triggered.

Only guided generation (`respondWithSchema()`, `respondWithJsonSchema()`) throws this. For a plain-text `respond()` or `streamResponse()`, a refusal comes back as ordinary text, and Apple says you may not be able to tell a refusal from a normal answer programmatically. So in the common case you won't see `RefusalError` from `respond()`.

### InvalidGenerationSchemaError

Your `GenerationSchema` is malformed or was rejected by the on-device model. Common causes: unsupported property types, conflicting guides, a `$ref` to a definition that doesn't exist, or schemas that are too complex for the model to constrain.

A JSON schema that nests more than 128 levels deep, or that contains itself, is rejected before the request. Apple's framework would otherwise overflow its stack decoding it, which kills the process.

### ServiceCrashedError

An Apple Intelligence system service has crashed: the model manager, or the safety classifier every request passes through. This is an OS-level issue, not an SDK bug, and it affects every app on the Mac, Apple's `fm` command included.

macOS restarts the service itself, usually within a few minutes. Wait, then create a new session and retry. If it keeps failing, log out and back in, or restart the Mac. The services are protected by System Integrity Protection, so `launchctl` can't restart them.

### SystemPressureError

The system refused to run the model because of the machine's current state,
most often memory pressure: "Not executed due to current system state
[\"CriticalMemoryPressure\"], try again later". `err.state` names the state.
It also covers a request preempted by a higher-priority one (`state:
"Preempted"`), and the system reporting insufficient resources, which names no
state (`state` is `undefined`).

Nothing is wrong with your code or the model. It clears on its own, usually
within a few minutes. Retry then, and free memory if it persists. If it still
fails, log out or restart the Mac. `launchctl` can't restart these services
while System Integrity Protection is on.

Don't call `waitUntilAvailable()` here: availability already reports success,
so it returns at once and the next request fails the same way.

While this lasts, `isAvailable()` may still report `{ available: true }`. It describes whether the
model is installed and the device is eligible, not whether the runtime will accept a request.
`contextSize` is a better signal: it reads `0` while the runtime is refusing work.

```ts
const model = new SystemLanguageModel();
const ready = model.isAvailable().available && model.contextSize > 0;
```

`tsfm doctor` runs the same check and reports a zero-token context as unhealthy.

### ToolCallError

Your tool's `call()` method threw during execution. The SDK wraps the original
error with the tool name and sends its message back to the model as tool output.
The response continues, and `ToolCallError` is not thrown by `respond()`.

To stop generation, throw `FailRequestError` instead. Text, structured and
streaming requests then reject with `RequestFailedByToolError`. Check its
`toolName` and `cause` for the failing invocation. Synchronous throws and rejected
Promises behave alike, and concurrent sessions sharing a tool each retain their
own failure. See [Failing the request](/api/tool#failing-the-request).

## Catching All SDK Errors

```ts
import { FoundationModelsError } from "tsfm-sdk";

try {
  await session.respond("...");
} catch (e) {
  if (e instanceof FoundationModelsError) {
    console.error("SDK error:", e.message);
  }
}
```
