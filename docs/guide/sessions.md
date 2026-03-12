# Sessions

`LanguageModelSession` manages conversation state and provides all generation methods. Each session maintains its own context window and [transcript](/guide/transcripts).

::: info
The **Swift** equivalent is [`LanguageModelSession`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession).
:::

## Creating a Session

```ts
import { LanguageModelSession } from "tsfm-sdk";

const session = new LanguageModelSession({
  instructions: "You are a concise assistant.",
});
```

### With a Specific Model

```ts
const model = new SystemLanguageModel({ useCase: SystemLanguageModelUseCase.CONTENT_TAGGING });
const session = new LanguageModelSession({ model });
```

### With Tools

```ts
const session = new LanguageModelSession({
  tools: [weatherTool, calculatorTool],
});
```

## Generating Responses

### Text Response

```ts
const reply = await session.respond("What is the capital of France?");
console.log(reply); // "The capital of France is Paris."
```

### With Generation Options

```ts
const reply = await session.respond("Write a poem", {
  options: {
    temperature: 0.9,
    maximumResponseTokens: 200,
  },
});
```

See [Generation Options](/guide/generation-options) for all available options.

## Concurrency

Sessions serialize concurrent calls automatically. If you call `respond()` while another request is in progress, it queues and runs after the first completes:

```ts
// These run sequentially, not in parallel
const [a, b] = await Promise.all([
  session.respond("First question"),
  session.respond("Second question"),
]);
```

## Cancellation

Cancel an in-progress request with `cancel()`:

```ts
const promise = session.respond("Tell me a long story");
session.cancel();
```

Cancellation is advisory — the response may still complete if the model finishes before the cancel is processed. After cancellation, the session resets to idle and is ready for new requests.

## Checking State

`isResponding` tells you whether the session is currently processing a request:

```ts
if (session.isResponding) {
  // A generation call is in flight
}
```

## Cleanup

Always dispose sessions when done to release native memory:

```ts
session.dispose();
```

::: tip
If you prefer a higher-level interface, the [Chat API compatibility layer](/guide/chat-api) manages sessions automatically behind a more standard `chat.completions.create()` interface.
:::
