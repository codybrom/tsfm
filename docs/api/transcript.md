# Transcript

Represents a session's conversation history. Used to export and restore sessions.

## Accessing

Every session exposes its transcript:

```ts
const transcript = session.transcript;
```

::: warning
Export the transcript before calling `session.dispose()`. The transcript reads from the native session, and throws `FoundationModelsError` once the session is disposed.
:::

## Methods

### `toJson()`

Export the transcript as a JSON string.

```ts
toJson(): string
```

### `toDict()`

Export the transcript as a dictionary object.

```ts
toDict(): object
```

### `dispose()`

Release the C object backing a standalone transcript.

```ts
dispose(): void
```

Transcripts from `Transcript.fromJson()` / `fromDict()` own their own C object
until a session takes it over, so dispose them when you are done:

```ts
const transcript = Transcript.fromJson(savedJson);
try {
  console.log(transcript.entries());
} finally {
  transcript.dispose();
}
```

`Symbol.dispose` is supported, so `using` handles it for you:

```ts
using transcript = Transcript.fromJson(savedJson);
```

Safe to call more than once, and a no-op on the transcript reached through
`session.transcript` — the session owns that pointer and frees it in
`session.dispose()`.

Only a transcript you restored yourself can be passed to
`LanguageModelSession.fromTranscript()`. The one reached through
`session.transcript` belongs to that session — the bridge represents both as
the same kind of native object — so handing it over would redirect the original
session's transcript at the new session and break it when that session is
disposed. tsfm refuses it with `FoundationModelsError`. To branch a
conversation, export and restore:

```ts
const branch = LanguageModelSession.fromTranscript(
  Transcript.fromJson(session.transcript.toJson()),
);
```

Passing a restored transcript to `LanguageModelSession.fromTranscript()` hands it over:
the instance releases its own C object and reads from the new session from then
on (it is that session's `transcript`), and once that session is disposed the
instance is detached and its methods throw `FoundationModelsError`. Export it
first if you need the history afterwards, and don't reuse one instance for a
second `fromTranscript()` call; create a fresh one from the saved JSON.

Anything you miss is released when the handle is garbage collected, but that
runs at the collector's discretion, so prefer disposing explicitly. Reading a
disposed transcript throws rather than dereferencing freed memory.

## Static Methods

### `fromJson()`

Create a transcript from a JSON string.

```ts
static fromJson(json: string): Transcript
```

### `fromDict()`

Create a transcript from a dictionary object.

```ts
static fromDict(dict: object): Transcript
```

## Restoring a Session

```ts
const transcript = Transcript.fromJson(savedJson);
const session = LanguageModelSession.fromTranscript(transcript);
```

See [LanguageModelSession.fromTranscript()](/api/language-model-session#fromtranscript) for full options.
