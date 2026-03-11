# Transcripts

Transcripts let you save and restore session history, enabling persistent conversations across process restarts. This maps to Foundation Models' [`Transcript`](https://developer.apple.com/documentation/foundationmodels/transcript), which records instructions, user prompts, responses and tool results as a linear history.

## Entry Types

A transcript is a linear sequence of entries. These match the [`Transcript.Entry`](https://developer.apple.com/documentation/foundationmodels/transcript) cases in Swift:

| Role | Description |
| --- | --- |
| `instructions` | Behavioral directives provided to the model when creating the session. |
| `user` | User input passed to `respond()` or `streamResponse()`. |
| `response` | Model-generated output (text, structured content, or tool calls). |
| `tool` | Results returned from executed tools. |

## Inspecting Entries

Use `entries()` to access typed transcript entries without manually parsing JSON:

```ts
const entries = session.transcript.entries();

for (const entry of entries) {
  if (entry.role === "response" && entry.contents) {
    for (const content of entry.contents) {
      if (content.type === "text") console.log(content.text);
    }
  }
}
```

Each entry has a `role` (`"instructions"`, `"user"`, `"response"`, or `"tool"`) and role-specific fields:

| Field | Roles | Description |
| --- | --- | --- |
| `contents` | all | Array of text or structured content items. |
| `tools` | `instructions` | Tool definitions registered with the session. |
| `options` | `user` | Generation options for this prompt. |
| `responseFormat` | `user` | Schema constraint for structured output. |
| `toolCalls` | `response` | Tool invocations with name and arguments. |
| `assets` | `response` | Asset references in the response. |
| `toolName` | `tool` | Name of the tool that produced this output. |
| `toolCallID` | `tool` | ID linking this output to its tool call. |

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
