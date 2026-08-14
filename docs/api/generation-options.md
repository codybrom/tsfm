# GenerationOptions

Options that control generation behavior across all response methods.

## Interface

```ts
interface GenerationOptions {
  temperature?: number;
  maximumResponseTokens?: number;
  sampling?: SamplingMode;
}
```

| Property | Type | Description |
| --- | --- | --- |
| `temperature` | `number` | Controls randomness. Higher = more varied. Must be ≥ 0. |
| `maximumResponseTokens` | `number` | Max tokens in the response. Must be a positive integer. |
| `sampling` | `SamplingMode` | Sampling strategy. |

Invalid values throw immediately when the options are serialized (before the native call).

## Usage

```ts
await session.respond("prompt", {
  options: {
    temperature: 0.8,
    maximumResponseTokens: 500,
    sampling: SamplingMode.greedy(),
  },
});
```

## SamplingMode

### `SamplingMode.greedy()`

Deterministic sampling — always picks the most likely token.

```ts
static greedy(): SamplingMode
```

### `SamplingMode.random()`

Stochastic sampling with optional constraints.

```ts
static random(options?: {
  top?: number;
  seed?: number;
  probabilityThreshold?: number;
}): SamplingMode
```

| Parameter | Description |
| --- | --- |
| `top` | Top-K: only consider the K most likely tokens |
| `seed` | Random seed for reproducible output |
| `probabilityThreshold` | Top-P / nucleus: cumulative probability threshold |

### `SamplingModeType`

```ts
type SamplingModeType = "greedy" | "random"
```
