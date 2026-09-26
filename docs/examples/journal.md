# Journal

A journaling tool that extracts mood and themes from free-form entries, persists them
through model-invoked tools, and streams a reflection built from past entries.

<<< @/../examples/journal/journal.ts

## What This Shows

1. Two `Tool` subclasses the model actually calls during generation: `save_entry`
   writes analyses to disk and `query_entries` reads them back
2. The `onCall` callback surfacing tool invocations in the UI
3. `generable()` with `anyOf` for mood categories, `range` for intensity, and
   `minItems`/`maxItems` for themes
4. `streamResponse()` delivering the reflection as it is generated
5. Transcript persistence, so a session resumes across launches
