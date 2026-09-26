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
waitUntilAvailable(timeoutMs?: number, intervalMs?: number): Promise<AvailabilityResult>
```

| Parameter | Default | Description |
| --- | --- | --- |
| `timeoutMs` | `30000` | Maximum wait time in milliseconds |
| `intervalMs` | `500` | Polling interval in milliseconds |

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

Returns the language identifiers the model supports, as minimal BCP 47 language tags. Some carry a region where the model distinguishes one (e.g. `["en-GB", "en-AU", "fr-CA", "es-US", "de", "ja", "zh-TW"]`). They are languages, not full locales.

```ts
readonly supportedLanguages: string[]
```

### `contextSize`

The maximum number of tokens the model's context window can hold. All input (instructions, prompts, tool definitions, and responses) counts against this limit.

```ts
readonly contextSize: number
```

The size is per host and per model version, so read it rather than assuming it. Apple's documentation gives 4,096 tokens. On macOS 27.0, tsfm measured 8,192 with AFM 3 Core Advanced and 4,096 with AFM 3 Core. It's the budget for the whole session, not one prompt: instructions, tools, schemas, history and output all share it.

It reads `0` when the system is refusing to run the model (see [`SystemPressureError`](/guide/error-handling#systempressureerror)), so `contextSize > 0` doubles as a health check.

### `variant` <Badge type="warning" text="macOS 27" />

The on-device model's variant, e.g. `"AFM 3 Core Advanced"`, or `null` on macOS 26.

There have been three on-device model versions so far (macOS 26.0–26.3, 26.4 and 27.0), and Apple advises re-testing prompts against a new one. `variant` is how you tell which one you're running against on macOS 27: AFM 3 Core, or AFM 3 Core Advanced on the Macs that support it. You can't choose between them. See [Model variants](/guide/model-configuration#model-variants).

```ts
readonly variant: string | null
```

### `capabilities` <Badge type="warning" text="macOS 27" />

What the model can do, or `null` on macOS 26. On macOS 27.0 with AFM 3 Core, tsfm observes `"vision"`, `"toolCalling"` and `"guidedGeneration"`, and not `"reasoning"`.

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

Exactly one field applies per call, because the C bridge exposes a separate entry point
for each kind of input:

```ts
await model.tokenCount({ prompt: "Summarize this article." });
await model.tokenCount({ instructions: "You are a helpful assistant." });
await model.tokenCount({ tools: [weatherTool] });
await model.tokenCount({ schema: ContactCard.schema });
await model.tokenCount({ transcript: session.transcript });
```

Useful for staying inside `contextSize` before sending a request. Tool
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
| `DEVICE_NOT_ELIGIBLE` | Hardware not supported |
| `MODEL_NOT_READY` | Model assets still downloading |
| `UNKNOWN` | Unknown failure reason (0xff) |

## Types

### `AvailabilityResult`

```ts
type AvailabilityResult =
  | { available: true }
  | { available: false; reason: SystemLanguageModelUnavailableReason };
```
