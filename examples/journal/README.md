# Private Journal with Mood Tracking

A journaling tool that extracts mood and themes from free-form entries, persists them via model-invoked tools, and generates reflections by querying past entries — entirely on-device.

## Features Demonstrated

- **Tool subclasses** — `SaveEntryTool` and `QueryEntryTool` are registered with the session and called by the model during generation (not faked)
- **`onCall` callback** — UI feedback when the model invokes a tool
- **`generable()`** — Mood analysis schema with `anyOf` for mood categories, `range` for intensity, `minItems`/`maxItems` for themes
- **`streamResponse()`** — Reflection streamed to the terminal
- **Transcript persistence** — Export session for continuity across launches
- **Multi-turn workflow** — Extract structure, save via tool, query past entries via tool, stream reflection

## How It Works

1. User writes a free-form journal entry
2. Model extracts mood, intensity, themes, and a summary via structured output
3. Model calls `save_entry` tool to persist the analysis to a JSON file
4. Model calls `query_entries` tool to retrieve past entries
5. Model streams a reflection referencing the retrieved entries
6. Session transcript is exported for future resumption

## Run

```bash
npx tsx examples/journal/journal.ts         # interactive
npx tsx examples/journal/journal.ts --test  # uses default entry
```
