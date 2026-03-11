# Error Handling

All SDK errors extend `FoundationModelsError`. Generation-specific errors extend `GenerationError`, which itself extends `FoundationModelsError`. These map to Foundation Models' [`GenerationError`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/generationerror) cases, plus a few SDK-specific additions like `ServiceCrashedError`.

## Error Hierarchy

::: info FoundationModelsError
All errors inherit from `FoundationModelsError`.

**GenerationError** — errors during generation:

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

**ToolCallError** — a tool's `call()` method threw
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

The session's accumulated context (instructions, prompts, responses, tool calls) has exceeded what the model can hold. Everything in a session shares one context window, so long conversations or large tool outputs will eventually hit this. Dispose the session and start a new one, optionally seeding it with a trimmed [transcript](/guide/transcripts).

### AssetsUnavailableError

The on-device model files haven't finished downloading. This typically happens right after enabling Apple Intelligence or after a macOS update. Call `model.waitUntilAvailable()` before creating a session — it will resolve once the assets are ready.

### GuardrailViolationError

Apple's content safety guardrails flagged the prompt or the generated response. This is enforced at the OS level and cannot be disabled. If you're building an app that handles user-generated prompts, catch this and surface a user-friendly message rather than letting it propagate.

### UnsupportedGuideError

A `GenerationGuide` on one of your schema properties isn't supported by the current model version. This can happen if you use a guide that was introduced in a newer OS version than the user is running. Check your guide types against the [guides reference](/guide/structured-output#generation-guides).

### UnsupportedLanguageOrLocaleError

The system locale or the language of the prompt isn't supported by the on-device model. Foundation Models supports a subset of languages — this error means you've hit one it can't handle.

### DecodingFailureError

The model generated output during structured generation, but it couldn't be decoded into your schema. This can happen with complex or deeply nested schemas. Simplify the schema or add more descriptive property descriptions to guide the model.

### RateLimitedError

Too many requests to the on-device model in a short window. This is an OS-level rate limit, not a network API limit. Back off and retry after a short delay.

### ConcurrentRequestsError

You called a generation method on a session that's already processing a request. The SDK serializes calls internally via `_enqueue()`, so you shouldn't normally hit this. If you do, check that you're `await`ing calls or use `session.isResponding` to check state before calling.

### RefusalError

The model declined to generate a response. This is distinct from `GuardrailViolationError` — refusal means the model chose not to answer (e.g., the prompt asks for something outside its capabilities), not that a content filter triggered.

### InvalidGenerationSchemaError

Your `GenerationSchema` is malformed or was rejected by the on-device model. Common causes: unsupported property types, conflicting guides, or schemas that are too complex for the model to constrain. Also thrown when the native layer returns a `ModelManagerError Code=1041` rejection.

### ServiceCrashedError

The Apple Intelligence background service (`generativeexperiencesd`) has crashed. This is an OS-level issue, not an SDK bug. The error message includes the restart command:

```bash
launchctl kickstart -k gui/$(id -u)/com.apple.generativeexperiencesd
```

After restarting the service, create a new session and retry.

### ToolCallError

Your tool's `call()` method threw during execution. The SDK wraps the original error with the tool name so you can identify which tool failed and why. Access the original error via `err.cause`.

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
