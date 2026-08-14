# Transcript

Represents a session's conversation history. Used to export and restore sessions.

## Accessing

Every session exposes its transcript:

```ts
const transcript = session.transcript;
```

::: warning
Access the transcript before calling `session.dispose()`. The transcript reads from the native session pointer.
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

Transcripts from `Transcript.fromJson()` / `fromDict()` are independent C
objects that are not freed by disposing any session, so dispose them when you
are done:

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
`session.dispose()`. A `FinalizationRegistry` releases anything you miss, but
that runs at the garbage collector's discretion, so prefer disposing
explicitly. Reading a disposed transcript throws rather than dereferencing
freed memory.

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
