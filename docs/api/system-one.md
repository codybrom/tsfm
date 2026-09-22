# System One API

Import this API from `tsfm-sdk/system1` or its alias `tsfm-sdk/jev`.

```ts
import {
  SystemOneClient,
  TypeSafeClient,
  choice,
  score,
  noul,
} from "tsfm-sdk/system1";
```

See the [System One guide](/guide/system-one) for a complete example and the important differences
between this local adapter and Jev.

## `SystemOneClient`

```ts
new SystemOneClient({
  model?: SystemLanguageModel,
  generationOptions?: GenerationOptions,
  instructions?: string,
})
```

If `model` is omitted, the client creates and owns an on-device `SystemLanguageModel`. The public
`model` property can be used for availability checks. `TypeSafeClient` is a compatibility alias of
the same class.

### `systemOne()`

```ts
client.systemOne(request, options?): Promise<SystemOneResult>
```

`request` contains `state` and a nonempty `questions` map. `options` accepts `signal` and
`generationOptions`. Every question is evaluated in one structured-generation request.

On macOS 27, the returned `model` field identifies the variant selected by macOS, such as
`"AFM 3 Core"` or `"AFM 3 Core Advanced"`. On macOS 26 it is `"SystemLanguageModel"`, because the
variant API is unavailable. The client cannot select an on-device variant. See
[`SystemLanguageModel.variant`](/api/system-language-model#variant) for details.

### `dispose()`

Releases the model only when the client created it. A model supplied to the constructor remains
caller-owned. `Symbol.dispose` is also implemented.

## Builders

### `noul(instructions?, criteria?)`

Creates a yes/no question. Its result is `{ type: "noul", noul: number }`, where `noul` is the
estimated probability of `true`.

### `choice(instructions, criteria)`

Creates a 1–255 label choice. Its result contains `choice`, `probabilities`, and `confidence`.
Choice label types are preserved by TypeScript.

### `score(instructions, criteria)`

Creates an ordered rubric with 2–10 levels, numbered from zero. Its result contains the
probability-weighted `score`, `legend`, `probabilities`, and `confidence`.

## Types

The subpath exports:

- `JsonValue`, `EntryType`, `Description`
- `NoulQuestion`, `ChoiceQuestion`, `ScoreQuestion`, `Question`, `Questions`
- `NoulResponse`, `ChoiceResponse`, `ScoreResponse`, `ResultFor`
- `ChoiceCriteria`, `ScoreCriteria`, `ScoreLegend`, `ScoreOf`
- `SystemOneRequest`, `SystemOneRequestOptions`, `SystemOneClientConfig`
- `SystemOneResult`, `SystemOneUsage`

For Jev SDK-shaped imports, `RequestOptions`, `TypeSafeClientConfig`, and `Usage` are aliases of the
corresponding System One types.

`SystemOneUsage` is `{ input_tokens, output_tokens }`, or `null` on macOS 26.

::: warning Estimated, not calibrated
Apple Foundation Models generates these distributions as guided output. `confidence` is derived from
distribution concentration. Neither value carries Jev's calibration guarantee; validate thresholds
on your own data.
:::
