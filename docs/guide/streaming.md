# Streaming

TSFM can stream responses token-by-token using an async iterator. The on-device model produces cumulative snapshots, and the SDK diffs them internally so you receive only the new tokens on each iteration.

Only plain text streams. Structured output (`respondWithSchema()`, `respondWithJsonSchema()`) is buffered until complete. Apple's framework can stream partial structured snapshots, but tsfm's native layer doesn't expose that yet. See [What tsfm doesn't expose](/guide/getting-started#what-tsfm-doesnt-expose).

::: info
The **Swift** equivalent is [`LanguageModelSession.ResponseStream`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/responsestream).
:::

## Basic Streaming

```ts
import { LanguageModelSession } from "tsfm-sdk";

const session = new LanguageModelSession();

for await (const chunk of session.streamResponse("Tell me a joke")) {
  process.stdout.write(chunk);
}
console.log();

session.dispose();
```

Each `chunk` is a string containing only the **new** tokens since the last iteration.

## With Options

```ts
for await (const chunk of session.streamResponse("Write a story", {
  options: { temperature: 0.8, maximumResponseTokens: 500 },
})) {
  process.stdout.write(chunk);
}
```

## Collecting the Full Response

If you want both streaming output and the complete text:

```ts
let full = "";
for await (const chunk of session.streamResponse("Explain TypeScript")) {
  process.stdout.write(chunk);
  full += chunk;
}
console.log("\n\nFull response length:", full.length);
```

## Chat API Streaming

If you prefer the Chat API streaming interface, the [compatibility layer](/guide/chat-api#streaming) provides `stream: true` with `ChatCompletionChunk` objects:

```ts
import Client from "tsfm-sdk/chat";
const client = new Client();

const stream = await client.chat.completions.create({
  messages: [{ role: "user", content: "Tell me a joke" }],
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0].delta.content;
  if (delta) process.stdout.write(delta);
}
client.close();
```

## Early Break

You can `break` out of a stream at any time. The SDK automatically resets the session so subsequent calls work correctly:

```ts
for await (const chunk of session.streamResponse("Write a long essay")) {
  process.stdout.write(chunk);
  if (chunk.includes("conclusion")) break; // safe — session is reset internally
}

// The session is still usable
const { content: next } = await session.respond("Summarize what you said");
```

## Cancellation

Call `session.cancel()` to stop a stream mid-generation. A waiting iterator is
unblocked, and iteration ends on its next step. Cleanup waits for the terminal
native callback before releasing the request and queue lock, so a later request
cannot overlap the cancelled generation. Breaking out of the loop follows the
same cleanup path:

```ts
// From another context (e.g. a timeout or user action)
const timer = setTimeout(() => session.cancel(), 5000);

try {
  for await (const chunk of session.streamResponse("Write a long essay")) {
    process.stdout.write(chunk);
  }
} finally {
  clearTimeout(timer);
}

const { content: next } = await session.respond("Say hello.");
```

Cancellation ends stream iteration normally, and `collect()` returns the text
received so far. A one-shot request stopped by cancellation rejects with
`CancelledError`. See [Cancellation](/guide/sessions#cancellation) for requests
waiting on tools.

::: tip
Once the first snapshot has arrived, a stream that goes 30 seconds without another one ends with a `GenerationError` ("Stream idle timeout") rather than hanging. The timer isn't armed before the first snapshot, so a slow tool call or a long wait for the model at the start doesn't trip it.
:::

## Cleanup

The stream reference is released automatically when iteration completes or the session is disposed. The SDK keeps the Node.js event loop alive while streaming, so the process won't exit mid-stream.
