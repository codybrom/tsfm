# Transcripts

Transcripts let you save and restore session history, enabling persistent conversations across process restarts. This maps to Foundation Models' [`Transcript`](https://developer.apple.com/documentation/foundationmodels/transcript), which records instructions, prompts, responses, tool calls, and tool output as a linear history.

## Exporting a Transcript

Every session has a `transcript` property:

```ts
const session = new LanguageModelSession();
await session.respond("My name is Cody.");
await session.respond("I work on open source.");

// Export as JSON string
const json = session.transcript.toJson();

// Or as a dictionary object
const dict = session.transcript.toDict();
```

## Restoring a Session

Create a new session from a saved transcript:

```ts
import { Transcript, LanguageModelSession } from "tsfm-sdk";

// From JSON string
const transcript = Transcript.fromJson(json);
const resumed = LanguageModelSession.fromTranscript(transcript);

// From dictionary object
const transcript = Transcript.fromDict(dict);
const resumed = LanguageModelSession.fromTranscript(transcript);
```

The restored session has full context of the previous conversation:

```ts
const reply = await resumed.respond("What's my name?");
// The model remembers: "Your name is Cody."
```

## Full Example

```ts
// First session
const session = new LanguageModelSession();
await session.respond("My name is Cody.");
const json = session.transcript.toJson();
session.dispose();

// Later — resume from saved transcript
const resumed = LanguageModelSession.fromTranscript(Transcript.fromJson(json));
const recall = await resumed.respond("What's my name?");
console.log(recall); // References "Cody"
resumed.dispose();
```

::: warning
You must access `session.transcript` *before* calling `session.dispose()`. Transcripts are read from the native session pointer and will be lost when dispose runs.
:::
