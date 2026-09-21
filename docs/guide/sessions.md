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
const { content: reply } = await session.respond("What is the capital of France?");
console.log(reply); // "The capital of France is Paris."
```

### With Generation Options

```ts
const { content: reply } = await session.respond("Write a poem", {
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
// From a later user action or timeout, once generation has started:
const timer = setTimeout(() => session.cancel(), 5000);
try {
  await promise; // May reject with CancelledError.
} finally {
  clearTimeout(timer);
}
```

`cancel()` asks the native task to stop. It returns immediately and the pending
promise settles later. What to expect:

- The response can still complete if the model finishes before the cancel is
  processed. A request that was stopped rejects with `CancelledError`.
- A request waiting on a `Tool.call()` can be cancelled too. Its
  `context.signal` is aborted so the tool can stop work cooperatively. A tool
  that ignores the signal may keep running, but its eventual result is ignored. It cannot resume the cancelled generation after the session has been reused.
- Requests queued behind the cancelled one wait until it settles; `cancel()`
  doesn't remove them from the queue.
- For streams, cancellation unblocks a waiting iterator and the consumer loop
  exits on its next iteration. Cleanup waits for native completion before
  releasing the queue so later requests can run on the same session; see
  [Streaming](/guide/streaming#cancellation).

## Checking State

`isResponding` tells you whether the session is currently processing a request:

```ts
if (session.isResponding) {
  // A generation call is in flight
}
```

Apple's guidance is not to call `respond()` while `isResponding` is `true`. tsfm queues requests per session and runs them one at a time, so you don't have to check first; a second call waits for the first. That's also why `ConcurrentRequestsError` is nearly unreachable through tsfm.

## Cleanup

Always dispose sessions when done to release native memory:

```ts
session.dispose();
```

::: tip
If you prefer a higher-level interface, the [Chat API compatibility layer](/guide/chat-api) manages sessions automatically behind a more standard `chat.completions.create()` interface.
:::
