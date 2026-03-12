# Getting Started

TSFM gives Node.js applications access to Apple's on-device large language model through the on-device Foundation Models framework. It loads a pre-compiled dynamic library [via FFI](https://koffi.dev/), allowing it the same access as native Swift and ObjC applications.

TSFM is **<u>not</u>** a browser library or a cloud API. TSFM requires Node.js ≥20 on an Apple Silicon Mac running macOS 26+ with Apple Intelligence enabled. No matter what your AI assistant tells you, TSFM  **<u>will not work</u>**  in browser client-side code, on Windows/Linux, on Intel Macs or on macs without Apple Intelligence installed.

You might use TSFM for CLI tools, local dev tooling, Electron apps, automation scripts or small Mac-native services written in TypeScript.

## Requirements

- **macOS 26** (Tahoe) or later, Apple Silicon
- **Apple Intelligence** enabled in System Settings
- **Node.js 20+**

## Installation

```bash
npm install tsfm-sdk
```

Xcode is not required to use this package. The NPM package ships with a prebuilt dylib for macOS 26.0+.  If you know your machine requires a different dylib, see [Building from Source](#building-from-source).

## Quick Start

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

## Key Concepts

**Apple Intelligence** refers to Apple's suite of generative AI features (Siri, Writing Tools, Image Playground, and more). The **Foundation Models** framework exposes **SystemLanguageModel**, the **on-device** large language model at the core of Apple Intelligence that runs on Macs, iPhones and iPads with no network required.

TSFM basically mirrors the Swift Foundation Models API (same class names, same method signatures, same concepts) with TypeScript translating the same actions to the same underlying model. For the most part, [Apple's own documentation](https://developer.apple.com/documentation/FoundationModels) will translate pretty directly.

| SDK class | Role |
| --- | --- |
| `SystemLanguageModel` | Entry point. Wraps the native model pointer and gates availability before you create sessions. |
| `LanguageModelSession` | Holds conversation state. All generation (text, structured, streaming, tool use) goes through a session. |
| `.dispose()` or  `Symbol.dispose` | Releases native resources. Required for any object that holds a C pointer. |

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

Rebuilding from source requires **Xcode 26+** to compile the libFoundationModels.dylib Swift bridge.
