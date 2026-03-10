# tsfm Examples

Usage examples for the [tsfm](https://www.npmjs.com/package/tsfm-sdk) package.

## Prerequisites

- macOS 26+ (Tahoe) on Apple Silicon
- Apple Intelligence enabled
- Node.js 20+

## Setup

```bash
npm install tsfm-sdk
```

## Running Examples

Each example is a standalone script you can run with [tsx](https://www.npmjs.com/package/tsx):

```bash
npx tsx examples/<name>/<name>.ts
```

## Examples

| Example | Description |
| --------- | ------------- |
| [basic](./basic/) | Simple text generation with model availability check |
| [streaming](./streaming/) | Streaming response generation with real-time output |
| [structured-output](./structured-output/) | Guided generation using GenerationSchema |
| [json-schema](./json-schema/) | Generation using JSON Schema format |
| [tools](./tools/) | Custom Tool subclass for model-invoked functions |
| [generation-options](./generation-options/) | Sampling modes, temperature, and token limits |
| [transcript](./transcript/) | Session history persistence and resumption |
| [content-tagging](./content-tagging/) | Content classification with CONTENT_TAGGING use case |
