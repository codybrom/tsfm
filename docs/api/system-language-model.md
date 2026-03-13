# SystemLanguageModel

Represents the on-device Foundation Models language model. Provides availability checking and model configuration.

## Constructor

```ts
new SystemLanguageModel(options?: {
  useCase?: SystemLanguageModelUseCase;
  guardrails?: SystemLanguageModelGuardrails;
})
```

| Parameter | Default | Description |
| --- | --- | --- |
| `useCase` | `GENERAL` | Model use case |
| `guardrails` | `DEFAULT` | Guardrail configuration |

## Methods

### `isAvailable()`

Synchronously checks if the model is ready.

```ts
isAvailable(): AvailabilityResult
```

Returns `{ available: true }` or `{ available: false, reason: SystemLanguageModelUnavailableReason }`.

### `waitUntilAvailable()`

Polls until the model is available or the timeout expires.

```ts
waitUntilAvailable(timeoutMs?: number): Promise<AvailabilityResult>
```

| Parameter | Default | Description |
| --- | --- | --- |
| `timeoutMs` | `30000` | Maximum wait time in milliseconds |

### `supportsLocale()`

Check whether the model supports a given locale.

```ts
supportsLocale(localeIdentifier: string): boolean
```

```ts
model.supportsLocale("en_US"); // true
model.supportsLocale("ja_JP"); // true or false depending on model
```

### `dispose()`

Releases the native model reference.

```ts
dispose(): void
```

## Properties

### `supportedLanguages`

Returns the locale identifiers the model supports (e.g. `["en-US", "es-ES"]`).

```ts
readonly supportedLanguages: string[]
```

### `contextSize`

The maximum number of tokens the model's context window can hold. All input — instructions, prompts, tool definitions, and responses — counts against this limit.

```ts
readonly contextSize: number
```

### `tokenCount()` <Badge type="info" text="macOS 26.4+" />

Returns the number of tokens the model would use to encode the given text. Requires macOS 26.4+ runtime.

```ts
tokenCount(text: string): number
```

## Enums

### `SystemLanguageModelUseCase`

| Value | Description |
| --- | --- |
| `GENERAL` | General-purpose generation |
| `CONTENT_TAGGING` | Classification and labeling |

### `SystemLanguageModelGuardrails`

| Value | Description |
| --- | --- |
| `DEFAULT` | Standard content safety guardrails |
| `PERMISSIVE_CONTENT_TRANSFORMATIONS` | Relaxed guardrails for content transformation tasks (e.g. summarization, rewriting) |

### `SystemLanguageModelUnavailableReason`

| Value | Description |
| --- | --- |
| `APPLE_INTELLIGENCE_NOT_ENABLED` | Apple Intelligence is off |
| `MODEL_NOT_READY` | Model assets still downloading |
| `DEVICE_NOT_ELIGIBLE` | Hardware not supported |

## Types

### `AvailabilityResult`

```ts
type AvailabilityResult =
  | { available: true }
  | { available: false; reason: SystemLanguageModelUnavailableReason };
```
