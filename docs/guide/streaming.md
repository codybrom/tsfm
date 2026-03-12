# Streaming

TSFM can stream responses token-by-token using an async iterator. The on-device model produces cumulative snapshots, and the SDK diffs them internally so you receive only the new tokens on each iteration.

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

## Cleanup

The stream reference is released automatically when iteration completes or the session is disposed. The SDK keeps the Node.js event loop alive while streaming, so the process won't exit mid-stream.
