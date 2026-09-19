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

## Tool calls are limited per request

A request may now make at most 32 tool calls (`maximumToolCalls`), and fails with
`ToolCallLimitExceededError` instead of making another. Raise the limit if a
request legitimately needs more:

```ts
await session.respond(prompt, { options: { maximumToolCalls: 100 } });
```

`toolCallingMode` is new: `"allowed"` (the default, same as 0.x), `"required"` or
`"disallowed"`. See [tool calling modes](/guide/tools#tool-calling-modes).

## Regex guides are checked before the request

The macOS 27 on-device model supports only part of regex syntax, and notably not
character classes like `[a-z]`. Unsupported patterns now throw
`UnsupportedGuideError` before the request, naming the construct. See the
[supported syntax](/api/generation-schema#regex-patterns); most classes have a
replacement, such as `[0-9]` → `\d`.

## New: Private Cloud Compute

`PrivateCloudComputeLanguageModel` runs Apple's server model, with a 32K context
and `reasoningLevel`. It's opt-in and needs a host signed with Apple's PCC
entitlement; plain `node` can't use it. See
[Private Cloud Compute](/guide/private-cloud-compute).

## Errors

- `GenerationErrorCode` is a regular `enum` now, not a `const enum`. Comparisons
  against its members keep working. It now exists at runtime, and its numbers
  are no longer inlined into your build.
- New error classes, all subclasses of `GenerationError`: `InvalidArgumentError`,
  `TimeoutError`, `UnsupportedCapabilityError`, `UnsupportedTranscriptContentError`
  and `ToolCallLimitExceededError`. See [Errors](/api/errors).
- `PromptAttachmentError` no longer reports `unsupported-os` or `unsupported-sdk`,
  because attachments always work on macOS 27.
