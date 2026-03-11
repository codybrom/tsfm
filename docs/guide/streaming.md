# Streaming

Stream responses token-by-token using an async iterator. Foundation Models' native streaming yields cumulative snapshots — the SDK diffs them internally so you receive only new tokens on each iteration.

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

Each `chunk` is a string containing only the **new** tokens since the last iteration. Cumulative snapshots are handled by the SDK internally.

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

## How It Works

Under the hood, `streamResponse()`:

1. Creates a stream reference via the C bridge
2. Spawns a single Swift Task that yields cumulative snapshots
3. Diffs each snapshot against the previous to yield only new tokens
4. Releases the stream reference when iteration completes

The async iterator keeps the Node.js event loop alive until streaming finishes.
