# Email Triage

Classifying an inbox by priority, then streaming reply drafts with interactive
refinement. Nothing leaves the machine.

<<< @/../examples/email-triage/email-triage.ts

## What This Shows

1. `respondWithJsonSchema()` with a raw JSON Schema: nested objects, enums, and
   integer ranges, in contrast to the `generable()` builder used elsewhere
2. Per-call `GenerationOptions`: low temperature for classification, higher for
   drafting, with `maximumResponseTokens` tuned per call
3. `toObject<T>()` typing the triage result without a cast at the call site
4. `streamResponse()` for draft replies, refined over multiple turns using session context
5. Tools for loading the sample inbox and saving an approved draft
