<p align="center">
  <img src="docs/public/logo.svg" width="128" height="128" alt="tsfm">
</p>

<h1 align="center">tsfm</h1>

<p align="center">
  TypeScript SDK for Apple's <a href="https://developer.apple.com/documentation/foundationmodels">Foundation Models</a> framework.<br>
  Apple Intelligence in Node.js: the on-device model, and Private Cloud Compute. No keys. No fees.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/tsfm-sdk"><img src="https://img.shields.io/npm/v/tsfm-sdk" alt="npm"></a>
  <a href="https://github.com/codybrom/tsfm/actions/workflows/ci.yml"><img src="https://github.com/codybrom/tsfm/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/npm/l/tsfm-sdk" alt="license"></a>
</p>

---

- On-device inference by default, so your data never leaves the machine. Opt in to Apple's Private Cloud Compute model when you need more
- Covers two of the framework's three model paths: `SystemLanguageModel` and `PrivateCloudComputeLanguageModel`, not custom `LanguageModel` implementations ([what tsfm doesn't expose](https://tsfm.dev/guide/getting-started#what-tsfm-doesnt-expose))
- Streaming text generation
- Structured output with typed schemas and generation guides
- Tool calling
- Transcript persistence
- Chat-style and Responses-style APIs via `tsfm-sdk/chat` (or its alias, `tsfm-sdk/openai`)

## Quick Start

> [!NOTE]
> **tsfm 1.0 is in beta.** This README and [tsfm.dev](https://tsfm.dev) describe 1.0:
>
> ```bash
> npm install tsfm-sdk@beta
> ```
>
> A plain `npm install tsfm-sdk` installs the stable 0.5 release ([0.5 README](https://github.com/codybrom/tsfm/tree/v0.5.1#readme)). See [Migrating to 1.0](https://tsfm.dev/guide/migrating-to-1).

```ts
import { SystemLanguageModel, LanguageModelSession } from "tsfm-sdk";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable();
if (!available) process.exit(1);

const session = new LanguageModelSession({
  instructions: "You are a concise assistant.",
});

const { content: reply } = await session.respond("What is the capital of France?");
console.log(reply); // "The capital of France is Paris."

session.dispose();
model.dispose();
```

## Documentation

**[Read the full docs →](https://tsfm.dev/)**

- [Getting Started](<https://tsfm.dev/guide/getting-started>: installation, requirements, first steps, and [what tsfm doesn't expose](https://tsfm.dev/guide/getting-started#what-tsfm-doesnt-expose) of the framework
- [Sessions](https://tsfm.dev/guide/sessions): text generation, concurrency, cancellation
- [Streaming](https://tsfm.dev/guide/streaming): token-by-token response streaming
- [Structured Output](https://tsfm.dev/guide/structured-output): typed schemas with generation guides
- [Tools](https://tsfm.dev/guide/tools): function calling
- [Chat & Responses APIs](https://tsfm.dev/guide/chat-api): familiar Chat-style and Responses-style interfaces
- [API Reference](https://tsfm.dev/api/): complete API docs
- [Examples](https://tsfm.dev/examples/): runnable code for every feature

## Requirements

- Apple Silicon (M-Series) Mac running macOS 26 or later. Token usage, tool-calling modes, Private Cloud Compute, attachments and model info need macOS 27 ([details](https://tsfm.dev/guide/getting-started#macos-26-and-macos-27)).
- Apple Intelligence enabled in System Settings
- Node.js 24+

Unless you are building from source, Xcode is not required. Building from source needs Xcode 27.

## Development

```bash
npm run build              # build native dylib + compile TypeScript
npm test                   # run all tests
npm run test:unit          # unit tests only (works on any machine)
npm run test:integration   # integration tests (requires macOS 26+ and Apple Intelligence)
npm run test:integration:sdk27  # the same, in a host built with the macOS 27 SDK
npm run test:stress        # 10 rounds of native tool lifecycle/race tests (seed 41)
```

See [tests/README.md](tests/README.md) for stress seeds, PCC testing, and coverage limits.

## Contributing

Issues and PRs welcome. If something doesn't work on your machine or you find a missing API, [open an issue](https://github.com/codybrom/tsfm/issues).

## License

© 2026 Cody Bromley and contributors.

tsfm is licensed under the Apache 2.0 license. For complete licensing information, see this project's [LICENSE file](LICENSE.md).

The `tsfm-sdk` package available from NPM contains precompiled C bindings and libraries for working with Foundation Models on macOS 26 and 27, adapted from [python-apple-fm-sdk](https://github.com/apple/python-apple-fm-sdk) which is Copyright Apple Inc. and licensed under the Apache 2.0 license.

<small>This project is unaffiliated with Apple, Inc. The terms "Apple" and "Apple Intelligence" are trademarks of Apple Inc., registered in the U.S. and other countries and regions.</small>
