# Model Configuration

`SystemLanguageModel` is the entry point for the on-device model. It has the same class and role as [SystemLanguageModel](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) in Swift and wraps the native model pointer to gate availability before you create sessions.

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

## Use Cases

These map directly to Foundation Models' [`UseCase`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/usecase) enum:

| Value | Description |
| --- | --- |
| `GENERAL` | General-purpose text generation (default) |
| `CONTENT_TAGGING` | Optimized for classification and labeling tasks |

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

`waitUntilAvailable()` polls until the model is ready (default 30 seconds):

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
