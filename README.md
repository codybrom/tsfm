# tsfm

[![npm](https://img.shields.io/npm/v/tsfm-sdk)](https://www.npmjs.com/package/tsfm-sdk)
[![Tests](https://github.com/codybrom/tsfm/actions/workflows/test.yml/badge.svg)](https://github.com/codybrom/tsfm/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/tsfm-sdk)](LICENSE.md)

TypeScript/Node.js SDK for accessing Apple's [Foundation Models framework](https://developer.apple.com/documentation/foundationmodels). On-device Apple Intelligence inference in Node without an API gateway or local server.

Wraps the same C bridge used by [`apple/python-apple-fm-sdk`](https://github.com/apple/python-apple-fm-sdk) via [koffi](https://koffi.dev) FFI.

## Overview

- On-device inference (no network or API key required)
- Streaming text generation
- Guided generation with typed schemas and output constraints
- Tool calling
- Transcript persistence

## Requirements

- macOS 26 (Tahoe) or later, Apple Silicon
- Apple Intelligence enabled in System Settings
- Node.js 20+

## Installation

```bash
npm install tsfm-sdk
```

Xcode not required. A prebuilt `libFoundationModels.dylib` is bundled with the npm package. If your Mac needs a different Dylib, install from source. (See [Development](#development))

## Quick start

```ts
import { SystemLanguageModel, LanguageModelSession } from "tsfm-sdk";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable();
if (!available) process.exit(1);

const session = new LanguageModelSession({
  instructions: "You are a concise assistant.",
});

const reply = await session.respond("What is the capital of France?");
console.log(reply); // "The capital of France is Paris."
```

## API

### `SystemLanguageModel`

```ts
import { SystemLanguageModel, SystemLanguageModelUseCase, SystemLanguageModelGuardrails } from "tsfm-sdk";

const model = new SystemLanguageModel({
  useCase:    SystemLanguageModelUseCase.GENERAL,           // default
  guardrails: SystemLanguageModelGuardrails.DEFAULT,        // default
});

const { available, reason } = model.isAvailable();
const { available } = await model.waitUntilAvailable();       // waits up to 30s
const { available } = await model.waitUntilAvailable(10_000); // custom timeout

model.dispose();
```

### `LanguageModelSession`

```ts
const session = new LanguageModelSession({
  instructions?: string,
  model?:        SystemLanguageModel,
  tools?:        Tool[],
});

const text = await session.respond("prompt");
const content = await session.respondWithSchema("prompt", schema);
const content = await session.respondWithJsonSchema("prompt", schemaObject);

for await (const chunk of session.streamResponse("prompt")) {
  process.stdout.write(chunk);
}

session.cancel();   // cancel in-progress request
session.dispose();
```

All methods accept an optional `{ options?: [GenerationOptions](#generationoptions) }` argument.

### `GenerationSchema`

```ts
import { GenerationSchema, GenerationGuide } from "tsfm-sdk";

const schema = new GenerationSchema("Person", "A person profile")
  .property("name", "string", { description: "Full name" })
  .property("age", "integer", {
    description: "Age in years",
    guides: [GenerationGuide.range(0, 120)],
  })
  .property("tags", "array", {
    guides: [GenerationGuide.maxItems(5)],
    optional: true,
  });

const content = await session.respondWithSchema("Describe a software engineer", schema);
const name = content.value<string>("name");
const age  = content.value<number>("age");
```

**Property types:** `"string"` | `"integer"` | `"number"` | `"boolean"` | `"array"` | `"object"`

**Guide factory methods:**

| method | constrains |
| --- | --- |
| `GenerationGuide.anyOf(["a", "b"])` | enumerated string values |
| `GenerationGuide.constant("fixed")` | exact string value |
| `GenerationGuide.range(min, max)` | numeric range (inclusive) |
| `GenerationGuide.minimum(n)` | numeric lower bound |
| `GenerationGuide.maximum(n)` | numeric upper bound |
| `GenerationGuide.regex(pattern)` | string pattern |
| `GenerationGuide.count(n)` | exact array length |
| `GenerationGuide.minItems(n)` | minimum array length |
| `GenerationGuide.maxItems(n)` | maximum array length |
| `GenerationGuide.element(guide)` | applies a guide to array elements |

### `GenerationOptions`

```ts
import { SamplingMode } from "tsfm-sdk";

await session.respond("prompt", {
  options: {
    temperature: 0.8,
    maximumResponseTokens: 500,
    sampling: SamplingMode.greedy(),
    sampling: SamplingMode.random({ top: 50, seed: 42 }),
    sampling: SamplingMode.random({ probabilityThreshold: 0.9 }),
  },
});
```

### `Tool`

```ts
import { Tool, GenerationSchema, GeneratedContent, GenerationGuide } from "tsfm-sdk";

class WeatherTool extends Tool {
  readonly name        = "get_weather";
  readonly description = "Gets current weather for a city.";

  readonly argumentsSchema = new GenerationSchema("WeatherParams", "")
    .property("city",  "string", { description: "City name" })
    .property("units", "string", {
      description: "Temperature units",
      guides: [GenerationGuide.anyOf(["celsius", "fahrenheit"])],
    });

  async call(args: GeneratedContent): Promise<string> {
    const city  = args.value<string>("city");
    const units = args.value<string>("units");
    return `Sunny, 22°C in ${city} (${units})`;
  }
}

const tool = new WeatherTool();
const session = new LanguageModelSession({ tools: [tool] });
const reply = await session.respond("What's the weather in Tulsa?");

session.dispose();
tool.dispose();
```

### `Transcript`

```ts
import { Transcript } from "tsfm-sdk";

const json = session.transcript.toJson();
const dict = session.transcript.toDict();

const resumed = LanguageModelSession.fromTranscript(Transcript.fromJson(json));
const resumed = LanguageModelSession.fromTranscript(Transcript.fromDict(dict));
```

## Error handling

All errors extend `FoundationModelsError`:

```ts
import { ExceededContextWindowSizeError, GuardrailViolationError } from "tsfm-sdk";

try {
  await session.respond("...");
} catch (e) {
  if (e instanceof ExceededContextWindowSizeError) { /* ... */ }
  if (e instanceof GuardrailViolationError)        { /* ... */ }
}
```

| class | when |
| --- | --- |
| `ExceededContextWindowSizeError` | session history too long |
| `AssetsUnavailableError` | model not downloaded |
| `GuardrailViolationError` | content policy violation |
| `RateLimitedError` | too many requests |
| `ConcurrentRequestsError` | session already responding |
| `RefusalError` | model declined to answer |
| `DecodingFailureError` | structured generation parse error |
| `InvalidGenerationSchemaError` | malformed `GenerationSchema` |
| `UnsupportedLanguageOrLocaleError` | language not supported |
| `ToolCallError` | tool threw during `call()` |

## Examples

Runnable examples are in the [`examples/`](examples/) directory:

| Example | Description |
| --- | --- |
| [basic](examples/basic/) | Simple prompt and response |
| [streaming](examples/streaming/) | Token-by-token streaming |
| [structured-output](examples/structured-output/) | Typed schemas with `GenerationSchema` |
| [json-schema](examples/json-schema/) | JSON Schema-based structured output |
| [tools](examples/tools/) | Tool calling |
| [generation-options](examples/generation-options/) | Temperature, token limits, sampling |
| [transcript](examples/transcript/) | Session history persistence |
| [content-tagging](examples/content-tagging/) | Content tagging use case |

Run any example with:

```bash
npx tsx examples/basic/basic.ts
```

## Development

### Testing

Tests use [Vitest](https://vitest.dev) with [v8 coverage](https://vitest.dev/guide/coverage).

```bash
npm test                    # run all tests
npm run test:unit           # unit tests only
npm run test:integration    # integration tests (requires macOS 26 + Apple Intelligence)
```

Unit tests mock the FFI layer so they work on any machine. Integration tests hit the real on-device model, so you need macOS 26 with Apple Intelligence to run those.

### Building from source

```bash
npm run build    # clones code from Apple's Python SDK, compiles dylib, then runs tsc
npm run dev      # tsc --watch
npm run lint     # eslint
npm run format   # prettier
```

The build script requires Xcode 26+ to compile `native/libFoundationModels.dylib` locally.

## Contributing

Issues and PRs welcome. If something doesn't work on your machine or you find a missing API, open an issue.

## License

Apache 2.0 - See [LICENSE.md](LICENSE.md) for details.

The npm package bundles Apple's Foundation Models C bindings and prebuilt dylib, which are also Apache 2.0. See [NOTICE](NOTICE) for details.
