# Model Configuration

`SystemLanguageModel` is the entry point for the on-device model. It wraps the native model pointer to gate availability before you create sessions.

::: info
The **Swift** equivalent is [`SystemLanguageModel`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel).
:::

## Creating a Model

```ts
import {
  SystemLanguageModel,
  SystemLanguageModelUseCase,
  SystemLanguageModelGuardrails,
} from "tsfm-sdk";

const model = new SystemLanguageModel({
  useCase: SystemLanguageModelUseCase.GENERAL,
  guardrails: SystemLanguageModelGuardrails.DEFAULT,
});
```

Both options are optional and default to the values shown above.

## Guardrails

Guardrails control how the model handles potentially unsafe content in prompts and responses.

::: info
The **Swift** equivalent is [`SystemLanguageModel.Guardrails`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/guardrails).
:::

| Value | Description |
| --- | --- |
| `DEFAULT` | Blocks unsafe content in both prompts and responses. Use this for most applications. |
| `PERMISSIVE_CONTENT_TRANSFORMATIONS` | Allows transforming potentially unsafe text input into text responses. Use this when your app needs to process user-generated content that may contain sensitive material (e.g., content moderation tools, text rewriting). |

```ts
const model = new SystemLanguageModel({
  guardrails: SystemLanguageModelGuardrails.PERMISSIVE_CONTENT_TRANSFORMATIONS,
});
```

With `DEFAULT` guardrails, unsafe content may trigger a `GuardrailViolationError`. With `PERMISSIVE_CONTENT_TRANSFORMATIONS`, the model may attempt to transform the content instead of rejecting it outright.

`PERMISSIVE_CONTENT_TRANSFORMATIONS` only applies to plain-text responses (`respond()` and `streamResponse()`). For any other response type it behaves like `DEFAULT` and throws `GuardrailViolationError`, so it does nothing for `respondWithSchema()` or `respondWithJsonSchema()`.

## Use Cases

Use cases hint to the model what kind of task you're performing.

::: info
The **Swift** equivalent is [`SystemLanguageModel.UseCase`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/usecase).
:::

| Value | Description |
| --- | --- |
| `GENERAL` | General-purpose text generation (default) |
| `CONTENT_TAGGING` | Tuned to respond with tags. It always answers with tags (topics, emotions, actions, and so on) rather than prose, so use it for tagging, not for general classification or labeling. |

```ts
const tagger = new SystemLanguageModel({
  useCase: SystemLanguageModelUseCase.CONTENT_TAGGING,
});
```

## Checking Availability

The on-device model may not be available if Apple Intelligence is disabled, assets haven't finished downloading, or the hardware doesn't support it. Always check before creating a session.

### Synchronous Check

```ts
const { available, reason } = model.isAvailable();
if (!available) {
  console.log("Unavailable:", reason);
}
```

### Waiting for Availability

`waitUntilAvailable()` polls until the model is ready, with a default timeout of 30 seconds. If the failure is permanent (`DEVICE_NOT_ELIGIBLE` or `APPLE_INTELLIGENCE_NOT_ENABLED`), it returns immediately rather than waiting the full timeout. It only retries when the reason is `MODEL_NOT_READY`.

```ts
const { available } = await model.waitUntilAvailable();
const { available } = await model.waitUntilAvailable(10_000); // custom timeout
```

## Unavailability Reasons

When `available` is `false`, the `reason` field indicates why:

| Reason | Description |
| --- | --- |
| `APPLE_INTELLIGENCE_NOT_ENABLED` | Apple Intelligence is turned off in Settings |
| `MODEL_NOT_READY` | Model assets are still downloading |
| `DEVICE_NOT_ELIGIBLE` | Hardware doesn't support Foundation Models |

## Cleanup

Release native resources when you're done with the model:

```ts
model.dispose();
```
