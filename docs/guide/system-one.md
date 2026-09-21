# System One Decisions

`tsfm-sdk/system1` provides a decision-only interface inspired by TypeSafe AI's
[System One/Jev API](https://typesafe.ai/blog/introducing-system-one-models-and-jev). It turns shared
state into named, typed decisions instead of prose. Everything runs through Apple Foundation Models
on the Mac, with no API key or network request.

```ts
import { SystemOneClient, choice, noul, score } from "tsfm-sdk/system1";

const client = new SystemOneClient();
const { available } = await client.model.waitUntilAvailable();
if (!available) process.exit(1);

const result = await client.systemOne({
  state: { ticket: "I was charged twice. Please refund it today." },
  questions: {
    department: choice("Which team should handle this?", {
      billing: "Charges and refunds",
      technical: "Bugs and outages",
      sales: null,
    }),
    urgent: noul("Does this need a response today?"),
    frustration: score("How frustrated is the customer?", [
      "Calm",
      "Concerned",
      "Very angry",
    ]),
  },
});

console.log(result.answers.department.choice);       // "billing"
console.log(result.answers.department.probabilities); // labels mapped to probabilities
console.log(result.answers.urgent.noul);              // estimated P(true), 0...1
console.log(result.answers.frustration.score);        // probability-weighted score, 0...2

client.dispose();
```

The answer type is inferred from the question map. In the example,
`department.choice` is typed as `"billing" | "technical" | "sales"`.

## The Three Primitives

| Builder | Meaning | Result |
| --- | --- | --- |
| `noul(instructions, criteria?)` | Whether a statement is true | `noul`, the estimated probability of `true` |
| `choice(instructions, criteria)` | One mutually exclusive label | winning `choice`, per-label `probabilities`, `confidence` |
| `score(instructions, criteria)` | Position on an ordered 2–10 level rubric | expected `score`, `legend`, `probabilities`, `confidence` |

A choice accepts 1–255 labels. A score accepts 2–10 levels and numbers them from zero. State,
instructions, and descriptions may be strings or JSON-compatible objects and arrays.

All questions share one state and one guided-generation request. They are presented as independent
judgments and cannot depend on another answer. If one answer determines what data to fetch or what to
ask next, make a second call.

## What “Jev-like” Means

The programming model is Jev-like; the underlying model is not Jev.

- Jev is a purpose-built, parallel System One model trained for calibrated decisions. tsfm uses
  Apple's generative on-device model and guided JSON output.
- tsfm asks the model for probability distributions, normalizes them, selects the largest choice,
  and computes a score as the distribution's expected level.
- `confidence` measures distribution concentration: zero for a uniform distribution and one for a
  one-hot distribution. It is not a calibrated probability of correctness.
- Several questions are batched into one request, but Apple's model still generates the structured
  response autoregressively. Jev's latency and calibration claims do not transfer to this adapter.

Treat the values as model estimates. Evaluate them on labeled examples from your application before
using thresholds for consequential automation.

## Jev-shaped Imports

`tsfm-sdk/jev` is an alias of `tsfm-sdk/system1`, and `TypeSafeClient` is an alias of
`SystemOneClient`. This lets simple code written in the official JavaScript SDK's style keep its
shape while running locally:

```ts
import { TypeSafeClient, choice, noul } from "tsfm-sdk/jev";

const client = new TypeSafeClient();
const result = await client.systemOne({
  state: "A customer asks for a duplicate charge to be refunded.",
  questions: {
    route: choice("Which queue?", { billing: null, support: null }),
    refund: noul("Is the customer requesting money back?"),
  },
});
```

This is a source-compatible subset, not a drop-in implementation of the hosted client. API keys,
HTTP retries, model listing, and hosted model names such as `jev-latest` do not apply. Omit a hosted
`model` field; `model: "system"` is accepted when a request builder requires one.

## Model and Generation Options

`SystemOneClient` uses `SystemLanguageModel`, so macOS chooses the on-device model variant. See
[`SystemLanguageModel.variant`](/api/system-language-model#variant) for the system-wide behavior.
Model selection is determined by the system.

Supply an existing model when you need custom guardrails or shared ownership:

```ts
import { SystemLanguageModel } from "tsfm-sdk";
import { SystemOneClient } from "tsfm-sdk/system1";

const model = new SystemLanguageModel();
const client = new SystemOneClient({
  model,
  generationOptions: { temperature: 0 },
});

// The caller owns a supplied model.
client.dispose();
model.dispose();
```

When the client creates its own model, `dispose()` releases it. Each `systemOne()` call creates and
releases a fresh session so calls do not leak conversational state into later decisions. Pass an
`AbortSignal` or per-request generation options as the second argument:

```ts
await client.systemOne(request, {
  signal: controller.signal,
  generationOptions: { maximumResponseTokens: 128 },
});
```

`result.usage` uses the Jev-style `input_tokens` and `output_tokens` keys. It is `null` on macOS 26,
where Foundation Models does not report token usage.

TypeSafe AI and Jev are unaffiliated with tsfm. The aliases describe API shape only.
