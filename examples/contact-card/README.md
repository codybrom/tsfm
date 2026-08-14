# Contact Card Parser

Extract structured contact cards from messy text — email signatures, conference notes, business card OCR — entirely on-device.

## Features Demonstrated

- **`generable()`** with nested schemas — arrays of typed objects (emails, phones), optional fields, nested structure
- **`GenerationGuide`** — `anyOf` for phone/email types, `range` for confidence scores
- **`prewarm()`** — latency optimization by pre-caching the prompt prefix
- **Batch extraction** — multiple contacts parsed in a single multi-turn session
- **Chained generation** — structured extraction via `respondWithSchema()` followed by a natural-language summary via `respond()`

## How It Works

1. Three sample contacts are parsed sequentially using a shared session
2. Each contact is extracted into a typed `ContactCard` with emails, phones, location, and a confidence score
3. After all contacts are parsed, the model generates a summary highlighting ambiguities

## Run

```bash
npx tsx examples/contact-card/contact-card.ts
```
