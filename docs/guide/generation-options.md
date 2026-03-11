# Generation Options

Control temperature, token limits, and sampling strategy for any generation method. These map directly to Foundation Models' [GenerationOptions](https://developer.apple.com/documentation/foundationmodels/generationoptions).

## Usage

Pass `options` as part of the second argument to any generation method:

```ts
import { SamplingMode } from "tsfm-sdk";

const reply = await session.respond("Write a haiku about rain", {
  options: {
    temperature: 0.9,
    maximumResponseTokens: 100,
    sampling: SamplingMode.random({ top: 50, seed: 42 }),
  },
});
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `temperature` | `number` | Controls randomness. Higher values (e.g. 0.9) produce more varied output. |
| `maximumResponseTokens` | `number` | Maximum tokens in the response. Hard limits can produce truncated or malformed output. |
| `sampling` | `SamplingMode` | Sampling strategy (see below). |

## Sampling Modes

### Greedy

Always picks the most likely token. Deterministic output.

```ts
SamplingMode.greedy()
```

### Random

Sample from the token distribution with optional constraints:

```ts
// Top-K sampling with a seed for reproducibility
SamplingMode.random({ top: 50, seed: 42 })

// Probability threshold (nucleus/top-P)
SamplingMode.random({ probabilityThreshold: 0.9 })
```

| Parameter | Description |
| --- | --- |
| `top` | Only consider the top K most likely tokens |
| `seed` | Random seed for reproducible output |
| `probabilityThreshold` | Only consider tokens whose cumulative probability exceeds this threshold |
