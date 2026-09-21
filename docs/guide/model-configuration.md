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

## Model Variants

Apple updates its models through OS releases. `SystemLanguageModel` runs on the device, while
`PrivateCloudComputeLanguageModel` sends requests to Apple's server model. The operating system and
PCC service choose the exact model. Applications cannot force Core Advanced or Cloud Pro.

| Model | OS version | Runs on | Access from tsfm |
| --- | --- | --- | --- |
| *AFM 1 Core*[^early-core-names] | macOS 26.0–26.3 | On device | Available through `SystemLanguageModel` |
| *AFM 2 Core*[^early-core-names] | macOS 26.4+ | On device | Available through `SystemLanguageModel`, with improved instruction following and tool calling |
| **AFM 3 Core** | [macOS 27.0](https://machinelearning.apple.com/research/introducing-third-generation-of-apple-foundation-models) | On device | 3B dense model available through `SystemLanguageModel` |
| **AFM 3 Core Advanced** | macOS 27.0 | On device | 20B sparse multimodal model. macOS activates roughly 1B–4B parameters and selects this variant only on supported hardware. |
| **AFM 3 Cloud** | macOS 27.0 | PCC on Apple silicon | Served behind `PrivateCloudComputeLanguageModel`. The backend model is not selectable or reported. |
| **AFM 3 Cloud Pro** | macOS 27.0 | PCC on NVIDIA GPUs | More capable model for complex reasoning and agentic tool use. It is not directly selectable or reported. |
| **ADM 3 Cloud (Image)** | macOS 27.0 | PCC on Apple silicon | Image generation and editing model. It is not exposed by the Foundation Models language API. |

[^early-core-names]: **AFM 1 Core** and **AFM 2 Core** are informal names for the `SystemLanguageModel` versions included with macOS 26.0–26.3 and macOS 26.4+, respectively. Apple has not published either as an official model name or API identifier.

On macOS 27, inspect `model.variant` to see whether `SystemLanguageModel` selected AFM 3 Core or Core
Advanced. The property is unavailable on macOS 26. See
[Private Cloud Compute](/guide/private-cloud-compute) for server-model capabilities and
requirements.

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
