# LanguageModelSession

Manages conversation state and provides all generation methods — text, streaming, structured, and JSON Schema.

## Constructor

```ts
new LanguageModelSession(options?: {
  instructions?: string;
  model?: SystemLanguageModel | PrivateCloudComputeLanguageModel;
  tools?: Tool[];
})
```

| Parameter | Default | Description |
| --- | --- | --- |
| `instructions` | `undefined` | System prompt for the session |
| `model` | Default model | A configured `SystemLanguageModel`, or a [`PrivateCloudComputeLanguageModel`](/guide/private-cloud-compute) |
| `tools` | `[]` | Tools available during generation |

## Methods

### `respond()`

Generate a text response. The text is in `.content`; `.usage` has the tokens
this request used.

```ts
respond(prompt: string | PromptInput, options?: {
  options?: GenerationOptions
}): Promise<Response<string>>
```

```ts
const { content, usage } = await session.respond("What is the capital of France?");
console.log(content); // "Paris…"
console.log(usage?.input.totalTokens, usage?.output.totalTokens); // usage is null on macOS 26
```

### Prompt attachments <Badge type="warning" text="macOS 27" />

Every method that takes a prompt accepts a string or a `PromptInput`, which is
one of two shapes:

```ts
interface PromptAttachment {
  path: string; // an image file
  label?: string;
}

// The text, then its attachments.
interface TextPromptInput {
  text: string;
  attachments?: PromptAttachment[];
}

// Text and attachments in the order the model sees them.
interface ContentPromptInput {
  content: Array<string | PromptAttachment>;
}

type PromptInput = TextPromptInput | ContentPromptInput;
```

```ts
await session.respond({
  text: "What is in this picture?",
  attachments: [{ path: "/tmp/chart.png", label: "quarterly chart" }],
});

// Text after an image, or several images with text between them:
await session.respond({
  content: [
    { path: "/tmp/before.png", label: "before" },
    { path: "/tmp/after.png", label: "after" },
    "What changed between these two?",
  ],
});

// An image alone; no text is sent.
await session.respond({ content: [{ path: "/tmp/chart.png" }] });
```

Attachments are images only. Each path must be an existing file: otherwise
`respond()` throws a `PromptAttachmentError` with `reason: "not-found"` before
anything reaches the native library. Attachments need macOS 27; on macOS 26 the
reason is `"unsupported-os"`. If the bridge refuses one for another reason, the
reason is `"unknown"`.

### `respondWithSchema()`

Generate structured output matching a `GenerationSchema`.

```ts
respondWithSchema(prompt: string | PromptInput, schema: GenerationSchema, options?: {
  options?: GenerationOptions
}): Promise<Response<GeneratedContent>>
```

`.content` is a [`GeneratedContent`](/api/generation-schema#generatedcontent) with typed property access.

### `respondWithJsonSchema()`

Generate structured output from a JSON Schema object.

```ts
respondWithJsonSchema(prompt: string | PromptInput, schema: object, options?: {
  options?: GenerationOptions
}): Promise<Response<GeneratedContent>>
```

`.content` is a [`GeneratedContent`](/api/generation-schema#generatedcontent) with `toObject()` for the full result.

### `streamResponse()`

Stream a response token-by-token.

```ts
streamResponse(prompt: string | PromptInput, options?: {
  options?: GenerationOptions
}): ResponseStream
```

Iterate the `ResponseStream` with `for await`: each yielded string contains only
the new tokens since the last iteration. Its `usage` is set once the stream
finishes, and `collect()` reads the whole stream into a `Response<string>`.

```ts
const stream = session.streamResponse("Tell me a story");
for await (const delta of stream) process.stdout.write(delta);
console.log(stream.usage?.output.totalTokens);

// or
const { content, usage } = await session.streamResponse("Say hi").collect();
```

### `prewarm()`

Preload model resources and optionally cache a prompt prefix to reduce first-response latency. Fire-and-forget — the prewarm runs in the background on the native side. Apple says to call it at least a second before the first request for it to help, and that it guarantees nothing: it's a hint, and the framework may not act on it.

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

Ask the in-progress request to stop. Advisory: the response may complete before
the cancellation takes effect, and a stopped request rejects with
`CancelledError`. A request waiting on a
`Tool.call()` can't be interrupted until the tool answers; if the tool never
settles, `tool.dispose()` ends it. Queued requests wait for the cancelled one to
settle. For streams, `cancel()` unblocks the iterator and iteration ends normally
on its next step; `collect()` returns the text received so far. Stream cleanup
releases the queue lock so later requests can run on the same session.
See [Cancellation](/guide/sessions#cancellation).

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
const { content: reply } = await session.respond("Hello");
// session is released when the block exits
```

## Properties

### `usage` <Badge type="warning" text="macOS 27" />

Token usage accumulated over every response in the session. It equals the sum of
the `usage` values the individual responses returned. `null` on macOS 26, which
doesn't report usage, and once the session is disposed.

```ts
readonly usage: Usage | null
```

### `isResponding`

```ts
readonly isResponding: boolean
```

`true` while a generation request is in progress.

Apple says not to call `respond()` while this is `true`; in Swift that throws `ConcurrentRequestsError`. tsfm queues requests on a session and runs them one at a time, so calling `respond()` while responding just waits its turn. You rarely need to check this before a call.

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
  model?: SystemLanguageModel | PrivateCloudComputeLanguageModel;
  tools?: Tool[];
}): LanguageModelSession
```

The transcript carries its own instructions.

## Types

### `Response<T>`

```ts
interface Response<T> {
  readonly content: T;
  readonly usage: Usage | null; // null on macOS 26
}
```

### `Usage`

```ts
interface Usage {
  input: {
    totalTokens: number;  // everything the model read, including earlier turns
    cachedTokens: number; // the part of that it reused from its cache
  };
  output: {
    totalTokens: number;
    reasoningTokens: number; // always 0 on-device
  };
}
```

### `ResponseStream`

```ts
class ResponseStream implements AsyncIterable<string> {
  readonly usage: Usage | null | undefined; // set when the stream finishes; null on macOS 26
  collect(): Promise<Response<string>>;
}
```

A `ResponseStream` can be iterated only once.
