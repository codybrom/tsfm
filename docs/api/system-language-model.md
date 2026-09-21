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

Returns the language identifiers the model supports, as minimal BCP 47 language tags. Some carry a region where the model distinguishes one (e.g. `["en-GB", "en-AU", "fr-CA", "es-US", "de", "ja", "zh-TW"]`); they are languages, not full locales.

```ts
readonly supportedLanguages: string[]
```

### `contextSize`

The maximum number of tokens the model's context window can hold. All input — instructions, prompts, tool definitions, and responses — counts against this limit.

```ts
readonly contextSize: number
```

The size varies by model version and variant, so read it at runtime rather than hard-coding a limit.
The value is the entire session budget, not the largest user prompt. Instructions, framework-added
formatting, tools, schemas, history, and output all need room.

### `variant` <Badge type="warning" text="macOS 27" />

The on-device model's variant, e.g. `"AFM 3 Core Advanced"`, or `null` on macOS 26.

On macOS 27, `variant` distinguishes AFM 3 Core from AFM 3 Core Advanced. It is `null` on macOS 26,
so use the OS version instead. This guide informally calls the macOS 26.0–26.3 model AFM 1 Core and
the macOS 26.4+ model AFM 2 Core. Apple advises re-testing prompts whenever the system model changes.

AFM 3 Core is a dense 3-billion-parameter model. AFM 3 Core Advanced is a sparse
20-billion-parameter model that activates roughly 1–4 billion parameters per request on capable
hardware. macOS automatically selects between them and the API doesn't expose a variant selector. See
[Model variants](/guide/model-configuration#model-variants).

```ts
readonly variant: string | null
```

### `capabilities` <Badge type="warning" text="macOS 27" />

What the active model can do, or `null` on macOS 26. Read this property instead of assuming a fixed
capability set for every model variant.

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

Use this to stay inside `contextSize` before sending a request. Tool definitions and schemas often
consume more context than their visible text suggests.

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
