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

Check whether the model supports a locale. With no argument, the host's current
locale, as Apple's `supportsLocale(_:)` defaults to `.current`.

```ts
supportsLocale(localeIdentifier?: string): boolean
```

```ts
model.supportsLocale(); // the locale this process runs in
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

Returns the language identifiers the model supports, as minimal BCP 47 language tags. Some carry a region where the model distinguishes one (e.g. `["en-GB", "en-AU", "fr-CA", "es-US", "de", "ja", "zh-TW"]`); they are languages, not full locales.

```ts
readonly supportedLanguages: string[]
```

### `contextSize`

The maximum number of tokens the model's context window can hold. All input — instructions, prompts, tool definitions, and responses — counts against this limit.

```ts
readonly contextSize: number
```

The size is per host and per model version, so read it rather than assuming it. Apple's documentation gives 4,096 tokens; tsfm measured 8,192 on macOS 27.0.

### `variant` <Badge type="warning" text="macOS 27" />

The on-device model's variant, e.g. `"AFM 3 Core Advanced"`, or `null` on macOS 26.

There have been three on-device model versions so far (macOS 26.0–26.3, 26.4 and 27.0), and Apple advises re-testing prompts against a new one. `variant` is how you tell which one you're running against.

```ts
readonly variant: string | null
```

### `capabilities` <Badge type="warning" text="macOS 27" />

What the model can do, or `null` on macOS 26. Apple doesn't publish the set, which is why this property exists: read it rather than hard-coding it. On macOS 27.0 tsfm observed `"vision"`, `"toolCalling"` and `"guidedGeneration"`, and not `"reasoning"`.

```ts
readonly capabilities: ("vision" | "toolCalling" | "guidedGeneration" | "reasoning")[] | null
```

### `tokenCount()`

Counts the tokens an input consumes against the [context window](#contextsize).
Asynchronous. Needs macOS 26.4 or later. On macOS 26.0-26.3 it rejects with
`UnsupportedCapabilityError` (`minimumRequiredMacOS: 26.4`).

```ts
tokenCount(input: TokenCountInput): Promise<number>

type TokenCountInput =
  | { prompt: string | PromptInput }
  | { instructions: string }
  | { tools: Tool[] }
  | { schema: GenerationSchema }
  | { transcript: Transcript };
```

Exactly one field applies per call — the C bridge exposes a separate entry point
for each kind of input:

```ts
await model.tokenCount({ prompt: "Summarize this article." });
await model.tokenCount({ instructions: "You are a helpful assistant." });
await model.tokenCount({ tools: [weatherTool] });
await model.tokenCount({ schema: ContactCard.schema });
await model.tokenCount({ transcript: session.transcript });
```

Useful for staying inside `contextSize` before sending a request — tool
definitions and schemas are often larger than they look. Measured against the
on-device model, a five-word prompt costs 15 tokens while a single-argument
tool definition costs 83.

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
