# Migrating to 1.0

tsfm 1.0 targets macOS 27 and adds token usage, tool-calling modes and more. Most
apps need two small changes: read `.content` from responses, and update to macOS 27.

## Requirements

- **macOS 27** or later. tsfm 1.x won't load on macOS 26; stay on `tsfm-sdk@0.x`
  there.
- **Xcode 27** to build from source. Installing from npm doesn't need Xcode.

## `respond()` returns a `Response`

`respond()`, `respondWithSchema()` and `respondWithJsonSchema()` now return a
`Response`: the old return value is in `.content`, next to the request's token
`usage`.

```ts
// 0.x
const reply = await session.respond("Hello");

// 1.0
const { content: reply } = await session.respond("Hello");
// or
const reply = (await session.respond("Hello")).content;
```

```ts
// 0.x
const cat = await session.respondWithSchema("Generate a cat", schema);
cat.value<string>("name");

// 1.0
const { content: cat } = await session.respondWithSchema("Generate a cat", schema);
cat.value<string>("name");
```

If you use `using` for the generated content:

```ts
using content = (await session.respondWithSchema(prompt, schema)).content;
```

## `streamResponse()` returns a `ResponseStream`

`for await` over `streamResponse()` works unchanged. The stream now also has
`usage` (set once it finishes) and `collect()`:

```ts
const stream = session.streamResponse("Tell me a story");
for await (const delta of stream) process.stdout.write(delta);
stream.usage?.output.totalTokens;
```

A `ResponseStream` can be iterated only once. Code that called `.next()`
directly on the old `AsyncGenerator` should use
`stream[Symbol.asyncIterator]()` instead.

## Token usage

Every response carries `usage`, and `session.usage` totals the whole session. See
[`Usage`](/api/language-model-session#usage-1).

The Chat and Responses compatibility APIs now fill in OpenAI's `usage` fields for
non-streaming requests instead of returning `null`.

## Errors

- `GenerationErrorCode` is a regular `enum` now, not a `const enum`. Comparisons
  against its members keep working. It now exists at runtime, and its numbers
  are no longer inlined into your build.
- New error classes, all subclasses of `GenerationError`: `InvalidArgumentError`,
  `TimeoutError`, `UnsupportedCapabilityError` and
  `UnsupportedTranscriptContentError`. See [Errors](/api/errors).
- `PromptAttachmentError` no longer reports `unsupported-os` or `unsupported-sdk`,
  because attachments always work on macOS 27.
