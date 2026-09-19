# Getting Started

TSFM gives Node.js applications access to Apple's on-device large language model through the on-device Foundation Models framework. It loads a precompiled native library through [Node-API](https://nodejs.org/api/n-api.html), which gives it the same access as native Swift and Objective-C apps.

TSFM is **<u>not</u>** a browser library or a cloud API. TSFM requires Node.js ≥24 on an Apple Silicon Mac running macOS 26 or later with Apple Intelligence enabled. No matter what your AI assistant tells you, TSFM **<u>will not work</u>** in browser client-side code, on Windows/Linux, on Intel Macs or on macs without Apple Intelligence installed.

You might use TSFM for CLI tools, local dev tooling, Electron apps, automation scripts or small Mac-native services written in TypeScript.

## Requirements

- **macOS 26** or later, Apple Silicon. A few features need macOS 27; see below.
- **Apple Intelligence** enabled in System Settings
- **Node.js 24+**

### macOS 26 and macOS 27

tsfm runs on both. Features built on macOS 27 APIs don't crash on macOS 26: each
reports a clear reason your app can check.

| Feature | On macOS 26 |
| --- | --- |
| Token usage (`response.usage`, `session.usage`) | `null` |
| `toolCallingMode` `"required"` or `"disallowed"` | Throws `UnsupportedCapabilityError` with `minimumRequiredMacOS: 27` |
| [Private Cloud Compute](/guide/private-cloud-compute) | `isAvailable()` reports `REQUIRES_NEWER_OS`; using it throws `UnsupportedCapabilityError` |
| [Prompt attachments](/api/language-model-session#prompt-attachments) | Throws `PromptAttachmentError` with `reason: "unsupported-os"` |
| `model.variant`, `model.capabilities` | `null` |
| `model.tokenCount()` (needs macOS 26.4) | On 26.0–26.3, rejects with `UnsupportedCapabilityError` with `minimumRequiredMacOS: 26.4` |

Everything else works on both, including text, streaming, structured output,
tools, transcripts and the Chat and Responses APIs. Regex guides are checked
against the model's supported syntax only on macOS 27, where it's known.

::: info
tsfm's integration tests run on macOS 27. On macOS 26, the library's loading and
fallbacks are verified at build time, but the model itself isn't tested there.
:::

## Installation

::: warning tsfm 1.0 is in beta
These docs are for 1.0, which is published under the `beta` tag. Install it with:

```bash
npm install tsfm-sdk@beta
```

A plain `npm install tsfm-sdk` still installs the stable 0.5 release, which has
[its own docs](https://github.com/codybrom/tsfm/tree/v0.5.1/docs). Coming from 0.5? See
[Migrating to 1.0](/guide/migrating-to-1).
:::

Xcode is not required to use this package. The npm package ships prebuilt native files for macOS 26.0+. If you know your machine requires a different build, see [Building from Source](#building-from-source).

To check that everything tsfm needs is in place, run:

```bash
npx tsfm doctor
```

It reports the macOS version, whether the native library loads, the on-device
model's availability and variant, and Private Cloud Compute availability. It only
reads; it doesn't change anything.

## Quick Start

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

## Key Concepts

**Apple Intelligence** refers to Apple's suite of generative AI features (Siri, Writing Tools, Image Playground, and more). The **Foundation Models** framework exposes **SystemLanguageModel**, the **on-device** large language model at the core of Apple Intelligence that runs on Macs, iPhones and iPads with no network required.

TSFM basically mirrors the Swift Foundation Models API (same class names, same method signatures, same concepts) with TypeScript translating the same actions to the same underlying model. For the most part, [Apple's own documentation](https://developer.apple.com/documentation/FoundationModels) will translate pretty directly.

| SDK class | Role |
| --- | --- |
| `SystemLanguageModel` | Entry point. Wraps the native model pointer and gates availability before you create sessions. |
| `LanguageModelSession` | Holds conversation state. All generation (text, structured, streaming, tool use) goes through a session. |
| `.dispose()` or `Symbol.dispose` | Releases native resources. Required for any object that holds a C pointer. |

## Where To Go From Here

- [Model Configuration](/guide/model-configuration) — Use cases, guardrails, availability
- [Sessions](/guide/sessions) — Creating and using sessions
- [Streaming](/guide/streaming) — Token-by-token response streaming
- [Structured Outputs](/guide/structured-output) — Typed generation with dictionary or JSON schemas
- [Tools](/guide/tools) — Function calling
- [Error Handling](/guide/error-handling) — Error types and recovery
- [Chat API Compatibility](/guide/chat-api) — Drop-in Chat API compatible interface

## Building from Source

If you are working on TSFM as a developer, or need to rebuild the native library, run:

```bash
git clone https://github.com/codybrom/tsfm.git
cd tsfm
npm run build
```

Rebuilding from source requires **Xcode 27** (the macOS 27 SDK and Swift 6.4) to compile the libFoundationModels.dylib Swift bridge in `native/bridge`.
