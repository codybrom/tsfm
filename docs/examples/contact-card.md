# Contact Card

Extracting structured contact cards from messy text — email signatures, conference
notes, business card OCR — entirely on-device.

<<< @/../examples/contact-card/contact-card.ts

## What This Shows

1. `generable()` with nested schemas — arrays of typed objects for emails and phones
2. `GenerationGuide` constraints — `anyOf` for contact types, `range` for the confidence score
3. Optional properties declared with `satisfies Record<string, PropertyDef>`, which keeps
   the literal types `InferSchema` needs to mark fields optional
4. `prewarm()` to cache the prompt prefix and cut first-response latency
5. Chained generation — structured extraction via `respondWithSchema()`, then a
   natural-language summary via `respond()` on the same session
