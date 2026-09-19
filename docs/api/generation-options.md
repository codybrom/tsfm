# GenerationOptions

Options that control generation behavior across all response methods.

## Interface

```ts
interface GenerationOptions {
  temperature?: number;
  maximumResponseTokens?: number;
  sampling?: SamplingMode;
  toolCallingMode?: "allowed" | "required" | "disallowed";
  maximumToolCalls?: number;
  reasoningLevel?: "light" | "moderate" | "deep";
}
```

| Property | Type | Description |
| --- | --- | --- |
| `temperature` | `number` | Controls randomness. Higher = more varied. Must be ≥ 0. |
| `maximumResponseTokens` | `number` | Max tokens in the response. Must be a positive integer. |
| `sampling` | `SamplingMode` | Sampling strategy. |
| `toolCallingMode` | `string` | `"allowed"` (default), `"required"` or `"disallowed"`. See [tool calling modes](/guide/tools#tool-calling-modes). `"required"` and `"disallowed"` need macOS 27; on macOS 26 they throw `UnsupportedCapabilityError`. |
| `reasoningLevel` | `string` | How much the model reasons first. [Private Cloud Compute](/guide/private-cloud-compute#reasoning) only; the on-device model throws `UnsupportedCapabilityError`. |
| `maximumToolCalls` | `number` | Most tool calls one request may make. Default `32`. The request fails with `ToolCallLimitExceededError` instead of making another. Must be a non-negative integer. |

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
| `top` | Top-K: only consider the K most likely tokens. A positive integer. |
| `seed` | Random seed for reproducible output. A non-negative integer up to `Number.MAX_SAFE_INTEGER`. |
| `probabilityThreshold` | Top-P / nucleus: cumulative probability threshold, from 0 to 1. |

`top` and `probabilityThreshold` can't both be set. The same checks run when a
request is sent, so a `sampling` object built by hand is validated too.

### `SamplingModeType`

```ts
type SamplingModeType = "greedy" | "random"
```
