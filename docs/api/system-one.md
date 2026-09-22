# System One API

Import this API from `tsfm-sdk/system1` or its alias `tsfm-sdk/jev`.

```ts
import {
  SystemOneClient,
  TypeSafeClient,
  choice,
  score,
  noul,
  fitNoulCalibration,
  fitDistributionCalibration,
} from "tsfm-sdk/system1";
```

See the [System One guide](/guide/system-one) for a complete example and the important differences
between this local adapter and Jev.

## `SystemOneClient`

```ts
new SystemOneClient({
  model?: SystemLanguageModel,
  instructions?: string,
  generationOptions?: GenerationOptions,
  perQuestionCalls?: boolean,
  polarityDebias?: boolean,
  ensemble?: { samples: number, permute?: boolean },
})
```

If `model` is omitted, the client creates and owns an on-device `SystemLanguageModel`. The public
`model` property can be used for availability checks. `TypeSafeClient` is a compatibility alias of
the same class.

The last four options are `SystemOneSettings`: defaults for every request, which a single request
can override.

| Setting | Default | Effect |
| --- | --- | --- |
| `generationOptions` | greedy sampling | Generation options for each call. Unrelated options such as `maximumResponseTokens` keep greedy sampling; setting `sampling` or `temperature` replaces it, and `SamplingMode.random()` gives the framework's default. |
| `perQuestionCalls` | `false` | Asks each question in its own request, so an answer doesn't depend on the other questions. Costs one call per question. |
| `polarityDebias` | `false` | Also asks every Noul for P(false) and averages the two estimates. Costs one extra call per request that contains a Noul. |
| `ensemble` | off | Evaluates the request `samples` times and averages the answers. `permute` rotates the questions and each Choice's criteria between samples. Under greedy sampling a sample that would repeat an earlier input is skipped, so with nothing to rotate the ensemble makes one call. |

`samples` must be a positive integer; the constructor and `systemOne()` throw otherwise. See the
[guide](/guide/system-one#ensembling) for what each setting measured on JevBench.

### `systemOne()`

```ts
client.systemOne(request, options?): Promise<SystemOneResult>
```

`request` contains `state` and a nonempty `questions` map. `options` accepts `signal` and any
`SystemOneSettings` to override the client's for this request. By default every question is
evaluated in one structured-generation request; `perQuestionCalls`, `polarityDebias` and `ensemble`
each add calls.

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

## Calibration

### `fitNoulCalibration(examples)`

Fits a temperature and bias to labelled Noul outcomes, `{ probability, actual }[]`, by minimizing log
loss. Returns `{ temperature, bias, logLoss, apply(probability) }`.

### `fitDistributionCalibration(examples)`

Fits a temperature to labelled Choice or Score outcomes, `{ probabilities, actual }[]` where `actual`
is the index of the correct criterion. Returns `{ temperature, logLoss, apply(probabilities) }`.

Both need at least two examples and throw on malformed input. Fit on data the calibration will not
be evaluated on. They are also exported from `tsfm-sdk`.

## Types

The subpath exports:

- `JsonValue`, `EntryType`, `Description`
- `NoulQuestion`, `ChoiceQuestion`, `ScoreQuestion`, `Question`, `Questions`
- `NoulResponse`, `ChoiceResponse`, `ScoreResponse`, `ResultFor`
- `ChoiceCriteria`, `ScoreCriteria`, `ScoreLegend`, `ScoreOf`
- `SystemOneRequest`, `SystemOneRequestOptions`, `SystemOneClientConfig`, `SystemOneSettings`,
  `EnsembleOptions`
- `NoulExample`, `DistributionExample`, `NoulCalibration`, `DistributionCalibration`
- `SystemOneResult`, `SystemOneUsage`

For Jev SDK-shaped imports, `RequestOptions`, `TypeSafeClientConfig`, and `Usage` are aliases of the
corresponding System One types.

`SystemOneUsage` is `{ input_tokens, output_tokens }`, or `null` on macOS 26.

::: warning Estimated, not calibrated
Apple Foundation Models generates these distributions as guided output. `confidence` is derived from
distribution concentration. Neither value carries Jev's calibration guarantee; validate thresholds
on your own data, and consider fitting a calibration to it.
:::
