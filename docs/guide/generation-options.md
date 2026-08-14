# Generation Options

Control temperature, token limits, and sampling strategy for any generation method.

::: info
The **Swift** equivalent is Foundation Models' [`GenerationOptions`](https://developer.apple.com/documentation/foundationmodels/generationoptions).
:::

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
| `temperature` | `number` | Influences the confidence of the model's response. Higher values produce more varied output. Lower values produce more deterministic output. |
| `maximumResponseTokens` | `number` | Maximum tokens the model is allowed to produce. Enforcing a strict limit can lead to truncated or grammatically incorrect responses. |
| `sampling` | `SamplingMode` | Controls how the model picks tokens from its probability distribution (see below). |

## Sampling Modes

The model builds its response token by token. At each step it produces a probability distribution over its vocabulary. The sampling mode controls how a token is selected from that distribution.

::: info
The **Swift** equivalent is Foundation Models' [`SamplingMode`](https://developer.apple.com/documentation/foundationmodels/generationoptions/samplingmode).
:::

### Greedy (Most Deterministic)

Always chooses the most likely token. The same prompt should always produce the same output.

```ts
SamplingMode.greedy();
```

### Random

Samples from a subset of likely tokens. You must choose **one** of `top` or `probabilityThreshold`, but not both. Either can be combined with `seed` for reproducibility:

| Parameter | Description |
| --- | --- |
| `top` | Pick from the K most likely tokens (fixed set). Cannot be combined with `probabilityThreshold`. Maps to Apple's `random(top:seed:)`. |
| `probabilityThreshold` | Pick from the smallest set of tokens whose probabilities sum to this threshold. Cannot be combined with `top`. Maps to Apple's `random(probabilityThreshold:seed:)`. |
| `seed` | Random seed for reproducible output. Works with either constraint. |

```ts
// Top-K: pick from the 50 most likely tokens
SamplingMode.random({ top: 50, seed: 42 });

// Top-P (nucleus): pick from the smallest set of tokens whose probabilities add up to 0.9
SamplingMode.random({ probabilityThreshold: 0.9 });
```
