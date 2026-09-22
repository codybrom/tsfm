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

## Design Questions Like Decisions

A System One question should ask for one narrow semantic judgment that a knowledgeable person could
make quickly from the supplied state. Code still owns exact rules, arithmetic, policy, and control
flow.

- Put every fact needed for the judgment in `state`. Use named object fields when it has several
  parts.
- Write the complete judgment in `instructions`. Question-map keys identify answers for code, but are
  not presented to the model as meaningful instructions.
- Use `choice` to select one defined alternative, `noul` for an independent yes/no condition, and
  `score` for degree along an ordered rubric.
- Add an `other` or `none` choice when the listed alternatives may not cover the state.
- Ask independent questions over the same state together. Do not ask one question to reason from
  another answer in the same call.
- Generate candidate strings elsewhere, then use a decision to select one. Do counting, date
  comparison, multi-step calculations, and hard policy checks in ordinary code.

These practices come from the System One programming model and also make the local Apple adapter's
job more constrained. See TypeSafe's guides to [System One](https://docs.typesafe.ai/concepts/system-one)
and [building with System One](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) for the
model-independent design approach.

## What “Jev-like” Means

The programming model is Jev-like; the underlying model is not Jev.

- Jev is a purpose-built, parallel System One model trained for calibrated decisions. tsfm uses
  Apple's generative on-device model and guided JSON output.
- tsfm asks the model for probability distributions, normalizes them, selects the largest choice,
  and computes a score as the distribution's expected level.
- `confidence` measures distribution concentration: zero for a uniform distribution and one for a
  one-hot distribution. It is not a calibrated probability of correctness.
- Several questions are batched into one request, but Apple's model still generates the structured
  response autoregressively, so batching is not neutral here the way it is for Jev. Measured over a
  22-question rubric, Jev returned the same answer for every question whether
  it was batched or asked alone; this adapter agreed with itself 68% of the time. Enable `ensemble`
  with `permute` to average that sensitivity out, or `perQuestionCalls` to avoid batching entirely.
- Jev's latency and calibration claims do not transfer. On the same rubric Jev answered in 230ms at
  the median against this adapter's 4.7s, and its answers moved a twentieth as much across repeats.

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

`SystemOneClient` defaults to greedy (deterministic) sampling when no `generationOptions` are given.
On the public JevBench cases this was a consistent, no-downside improvement to decision quality and
calibration over the framework's own default sampling. Other generation options, such as
`maximumResponseTokens`, leave greedy sampling on; setting `sampling` or `temperature` replaces it,
and `sampling: SamplingMode.random()` asks for the framework's default:

```ts
import { SamplingMode, SystemLanguageModel } from "tsfm-sdk";
import { SystemOneClient } from "tsfm-sdk/system1";

const model = new SystemLanguageModel();
const client = new SystemOneClient({
  model,
  generationOptions: { sampling: SamplingMode.random() }, // the framework's own sampling
});

// The caller owns a supplied model.
client.dispose();
model.dispose();
```

### Ensembling

`ensemble` evaluates a request several times and averages the answers. It is the one setting we
tested that improved decisions *and* calibration together, and it is the recommended
starting point when answer quality matters more than cost:

```ts
const client = new SystemOneClient({
  ensemble: { samples: 3, permute: true },
});
```

`permute` rotates the questions, and each Choice question's criteria, between samples. The
on-device model is sensitive to both orderings — on JevBench it picked the second of
six criteria far less often than the labels warranted, and agreeing with itself only ~68% of the
time between a question asked inside a rubric and the same question asked alone. Rotation turns
that sensitivity into ensemble diversity rather than a fixed bias. It cancels the position bias
fully only when every label visits every position — `samples` at least as large as the longest
Choice's criteria; fewer samples reduce the bias without removing it.

Measured against the plain greedy default on the same prompt: on 120 JevBench easy and standard
decisions, accuracy rose from 70.8% to 75.0%, Brier loss fell 29%, and expected calibration error
halved. On a rubric-shaped case, accuracy rose from 68.2% to 81.8% — though that is 15 to 18 of 22
decisions, so read it as direction rather than size. Each sample is a full generation call, so a
request costs up to `samples` times as much.

When several samples disagree completely, the averaged distribution ties and `confidence` reports
close to zero. That is common — about a third of Choice answers across all JevBench tiers — and
those answers are worth routing to a person: they were right 30% of the time (14 of 47), against 70%
for answers the samples agreed on.

### Other knobs

These are off by default.

- `perQuestionCalls: true` — evaluates each question in its own generation call instead of batching a
  request's questions into one, so an answer no longer depends on what else was asked alongside it.
  That buys reproducibility rather than accuracy: over a 22-question rubric, batched and isolated
  answers disagreed on 5 questions, and the batched answer was right on 2 of them and the isolated
  one on 3. It costs `N` calls for `N` questions.
- `polarityDebias: true` — also asks every Noul in mirror image, for the probability that it is
  *false*, and averages the two estimates. The on-device model says "true" more often than the
  labels warrant, and asking both ways cancels that lean. Over 36 JevBench Nouls it left accuracy
  unchanged at 83.3% and cut Noul Brier loss by 19%, from 0.347 to 0.281. It costs one extra call for
  each request that contains a Noul, and none for a request that does not.

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
