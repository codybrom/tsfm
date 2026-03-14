<p align="center">
  <img src="docs/public/logo.svg" width="128" height="128" alt="tsfm">
</p>

<h1 align="center">tsfm</h1>

<p align="center">
  TypeScript SDK for Apple's <a href="https://developer.apple.com/documentation/foundationmodels">Foundation Models</a> framework.<br>
  On-device Apple Intelligence in Node.js — No keys. No fees. <i>It just works.</i>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/tsfm-sdk"><img src="https://img.shields.io/npm/v/tsfm-sdk" alt="npm"></a>
  <a href="https://github.com/codybrom/tsfm/actions/workflows/ci.yml"><img src="https://github.com/codybrom/tsfm/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/npm/l/tsfm-sdk" alt="license"></a>
</p>

---

- On-device inference — your data never leaves the machine
- Streaming text generation
- Structured output with typed schemas and generation guides
- Tool calling
- Transcript persistence
- Chat-style and Responses-style APIs via `tsfm-sdk/chat`

## Quick Start

```bash
npm install tsfm-sdk
```

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

session.dispose();
model.dispose();
```

## Documentation

**[Read the full docs →](https://tsfm.dev/)**

- [Getting Started](https://tsfm.dev/guide/getting-started) — installation, requirements, first steps
- [Sessions](https://tsfm.dev/guide/sessions) — text generation, concurrency, cancellation
- [Streaming](https://tsfm.dev/guide/streaming) — token-by-token response streaming
- [Structured Output](https://tsfm.dev/guide/structured-output) — typed schemas with generation guides
- [Tools](https://tsfm.dev/guide/tools) — function calling
- [Chat & Responses APIs](https://tsfm.dev/guide/chat-api) — familiar Chat-style and Responses-style interfaces
- [API Reference](https://tsfm.dev/api/) — complete API docs
- [Examples](https://tsfm.dev/examples/) — runnable code for every feature

## Requirements

- Apple Silicon (M-Series) Mac running macOS 26 or later
- Apple Intelligence enabled in System Settings
- Node.js 20+

Unless you are building from source, Xcode is not required.

## Development

```bash
npm run build              # build native dylib + compile TypeScript
npm test                   # run all tests
npm run test:unit          # unit tests only (works on any machine)
npm run test:integration   # integration tests (requires macOS 26 + Apple Intelligence)
```

## Contributing

Issues and PRs welcome. If something doesn't work on your machine or you find a missing API, [open an issue](https://github.com/codybrom/tsfm/issues).

## License

© 2026 Cody Bromley and contributors.

tsfm is licensed under the Apache 2.0 license. For complete licensing information, see this project's [LICENSE file](LICENSE.md).

The `tsfm-sdk` package available from NPM contains precompiled C bindings and libraries for working with macOS 26 Foundation Models adapted from [python-apple-fm-sdk](https://github.com/apple/python-apple-fm-sdk) which is Copyright Apple Inc. and licensed under the Apache 2.0 license.

<small>This project is unaffiliated with Apple, Inc. The terms "Apple" and "Apple Intelligence" are trademarks of Apple Inc., registered in the U.S. and other countries and regions.</small>
