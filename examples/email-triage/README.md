# Email Priority Triage with Draft Replies

Feed inbox emails through on-device AI for priority classification, then stream reply drafts with interactive refinement — nothing leaves your machine.

## Features Demonstrated

- **`respondWithJsonSchema()`** — Complex raw JSON Schema with nested objects, enums, and integer ranges (contrasts with `generable()` used in other examples)
- **Per-call `GenerationOptions`** — Low temperature (0.2) for triage classification, higher (0.7) for creative draft writing; `maximumResponseTokens` tuned per call
- **`streamResponse()`** — Reply drafts streamed to the terminal in real-time
- **Multi-turn refinement** — User says "shorter" or "more formal" and the model re-drafts using session context
- **Tool subclasses** — `FetchEmailsTool` loads emails from a bundled JSON file, `SaveDraftTool` persists approved replies. Both are called by the model during generation.
- **`onCall` callback** — UI feedback when tools are invoked

## How It Works

1. Model calls `fetch_emails` tool to load the sample inbox
2. Emails are triaged via `respondWithJsonSchema()` — priority, category, suggested action
3. Results displayed sorted by priority with color-coded labels
4. For the highest-priority "reply-now" email, a draft is streamed
5. User can iteratively refine the draft in a multi-turn conversation
6. Approved draft is saved via `save_draft` tool

## Run

```bash
npx tsx examples/email-triage/email-triage.ts         # interactive
npx tsx examples/email-triage/email-triage.ts --test  # skips refinement
```
