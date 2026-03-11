# Streaming

TSFM can stream responses token-by-token using an async iterator. Foundation Models' native streaming yields cumulative snapshots and the TSFM SDK diffs them internally so you receive only new tokens on each iteration. Under the hood, this is wrapping Foundation Models' [`ResponseStream`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/responsestream).

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

## Cleanup

The stream reference is released automatically when iteration completes or the session is disposed. The SDK keeps the Node.js event loop alive while streaming, so the process won't exit mid-stream.
