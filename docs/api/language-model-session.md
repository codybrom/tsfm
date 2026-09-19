# LanguageModelSession

Manages conversation state and provides all generation methods — text, streaming, structured, and JSON Schema.

## Constructor

```ts
new LanguageModelSession(options?: {
  instructions?: string;
  model?: SystemLanguageModel;
  tools?: Tool[];
})
```

| Parameter | Default | Description |
| --- | --- | --- |
| `instructions` | `undefined` | System prompt for the session |
| `model` | Default model | A configured `SystemLanguageModel` |
| `tools` | `[]` | Tools available during generation |

## Methods

### `respond()`

Generate a text response.

```ts
respond(prompt: string | PromptInput, options?: {
  options?: GenerationOptions
}): Promise<string>
```

### Prompt attachments <Badge type="warning" text="macOS 27" />

Every method that takes a prompt accepts either a string or `PromptInput`:

```ts
interface PromptInput {
  text: string;
  attachments?: { path: string; label?: string }[];
}

await session.respond({
  text: "What is in this picture?",
  attachments: [{ path: "/tmp/chart.png", label: "quarterly chart" }],
});
```

Attachments are always available on macOS 27, which tsfm 1.x requires. If the
bridge refuses one anyway, `respond()` throws a `PromptAttachmentError` with
`reason: "unknown"`.

### `respondWithSchema()`

Generate structured output matching a `GenerationSchema`.

```ts
respondWithSchema(prompt: string | PromptInput, schema: GenerationSchema, options?: {
  options?: GenerationOptions
}): Promise<GeneratedContent>
```

Returns a [`GeneratedContent`](/api/generation-schema#generatedcontent) with typed property access.

### `respondWithJsonSchema()`

Generate structured output from a JSON Schema object.

```ts
respondWithJsonSchema(prompt: string | PromptInput, schema: object, options?: {
  options?: GenerationOptions
}): Promise<GeneratedContent>
```

Returns a [`GeneratedContent`](/api/generation-schema#generatedcontent) with `toObject()` for the full result.

### `streamResponse()`

Stream a response token-by-token.

```ts
streamResponse(prompt: string | PromptInput, options?: {
  options?: GenerationOptions
}): AsyncIterable<string>
```

Each yielded string contains only the new tokens since the last iteration.

### `prewarm()`

Preload model resources and optionally cache a prompt prefix to reduce first-response latency. Fire-and-forget — the prewarm runs in the background on the native side.

```ts
prewarm(promptPrefix?: string): void
```

| Parameter | Default | Description |
| --- | --- | --- |
| `promptPrefix` | `undefined` | Text the model should expect at the start of the first prompt |

```ts
const session = new LanguageModelSession({ instructions: "You are a helpful assistant." });
session.prewarm("Translate the following");
// ... later, the first respond() call will be faster
```

### `cancel()`

Cancel an in-progress request. Advisory — the response may complete before cancellation takes effect.

```ts
cancel(): void
```

### `dispose()`

Release session resources. Access `transcript` before calling this. Safe to call multiple times.

```ts
dispose(): void
```

After disposal:

- `respond()`, `respondWithSchema()`, `respondWithJsonSchema()`, and `streamResponse()` throw `FoundationModelsError`
- `prewarm()`, `cancel()`, and `isResponding` are silent no-ops

Also supports `Symbol.dispose` for use with TC39 Explicit Resource Management:

```ts
using session = new LanguageModelSession();
const reply = await session.respond("Hello");
// session is released when the block exits
```

## Properties

### `isResponding`

```ts
readonly isResponding: boolean
```

`true` while a generation request is in progress.

### `transcript`

```ts
readonly transcript: Transcript
```

The session's conversation history. See [Transcript](/api/transcript).

## Static Methods

### `fromTranscript()`

Create a new session from a saved transcript.

```ts
static fromTranscript(transcript: Transcript, options?: {
  instructions?: string;
  model?: SystemLanguageModel;
  tools?: Tool[];
}): LanguageModelSession
```
