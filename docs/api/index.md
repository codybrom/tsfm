# API Reference

Complete reference for all public exports from `tsfm`.

## Classes

| Class | Description |
| --- | --- |
| [SystemLanguageModel](/api/system-language-model) | On-device model access and availability |
| [LanguageModelSession](/api/language-model-session) | Conversation session with all generation methods |
| [GenerationSchema](/api/generation-schema) | Schema builder for structured output |
| [Tool](/api/tool) | Abstract base class for tool calling |
| [Transcript](/api/transcript) | Session history export and import |

## Types and Enums

| Export | Description |
| --- | --- |
| [GenerationOptions](/api/generation-options) | Options for temperature, tokens, sampling |
| [SamplingMode](/api/generation-options#samplingmode) | Greedy or random sampling strategies |
| [GenerationGuide](/api/generation-schema#generationguide) | Output constraints for schema properties |
| [GeneratedContent](/api/generation-schema#generatedcontent) | Structured generation result |
| [Errors](/api/errors) | Error hierarchy and error codes |

## Chat & Responses APIs

| Export | Description |
| --- | --- |
| [Client](/api/chat) | Chat-style and Responses-style API client backed by on-device Apple Intelligence |

```ts
import Client from "tsfm-sdk/chat";
```

See the [Chat & Responses API reference](/api/chat) for full type documentation.

## Installation

```ts
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  Tool,
  Transcript,
  SamplingMode,
} from "tsfm-sdk";

// Chat API compatible interface
import Client from "tsfm-sdk/chat";
```
