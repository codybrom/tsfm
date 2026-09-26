# Chat & Responses API Reference

API reference for `tsfm-sdk/chat` (also available as `tsfm-sdk/openai`; both import paths load the same module). This module provides a compatibility layer with a Responses API and Chat Completions API backed by on-device Apple Intelligence.

```ts
import Client, { Stream, ResponseStream, MODEL_DEFAULT } from "tsfm-sdk/chat";
```

## Client

Main client class. Provides Chat-style and Responses-style API interfaces backed by on-device Apple Intelligence, or by Private Cloud Compute when a request sets `model: "PrivateCloudComputeLanguageModel"` (or its alias `"pcc"`).

### Constructor

```ts
const client = new Client();
```

No arguments. No API key needed.

### Properties

| Property | Type | Description |
| --- | --- | --- |
| `responses` | `Responses` | Responses API endpoint |
| `chat.completions` | `Completions` | Chat Completions API endpoint |

### Methods

#### `close()`

Releases the native models (the on-device model, and the Private Cloud Compute model if a request used it). Call when you're done with the client.

```ts
client.close(): void
```

---

## Responses API

### Responses

Accessed via `client.responses`. Similar to the  modern Responses API interface used by OpenAI.

#### `responses.create(params)`

Creates a response.

```ts
// Non-streaming
create(params: ResponseCreateParams & { stream?: false | null }): Promise<Response>

// Streaming
create(params: ResponseCreateParams & { stream: true }): Promise<ResponseStream>
```

---

### ResponseCreateParams

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `input` | `string \| ResponseInputItem[]` | Yes | Text prompt or array of input items |
| `model` | `string` | No | `"SystemLanguageModel"` (default) or `"PrivateCloudComputeLanguageModel"`; `"system"` and `"pcc"`, the ids Apple's `fm serve` uses, are aliases. Other names warn and use the on-device model. |
| `instructions` | `string` | No | System instructions |
| `stream` | `boolean` | No | Enable streaming |
| `temperature` | `number` | No | Sampling temperature. Foundation Models accepts 0 to 1, so a value above 1 is clamped to 1 with a warning |
| `max_output_tokens` | `number` | No | Maximum response tokens |
| `top_p` | `number` | No | Probability threshold for sampling |
| `seed` | `number` | No | Random seed for reproducibility |
| `tools` | `FunctionTool[]` | No | Tool definitions |
| `tool_choice` | `string \| object` | No | Accepted but ignored |
| `text` | `ResponseTextConfig` | No | Structured output configuration |
| `reasoning` | `{ effort?, summary? }` | No | `effort` maps to `reasoningLevel` for Private Cloud Compute; ignored with a warning for the on-device model. `summary` isn't supported. |

All other params (`previous_response_id`, `conversation`, `store`, `truncation`, `metadata`, etc.) are accepted but ignored with a runtime warning.

---

### Input Types

#### ResponseInputItem

```ts
type ResponseInputItem = EasyInputMessage | ResponseFunctionToolCall | FunctionCallOutput;
```

#### EasyInputMessage

```ts
{
  role: "user" | "assistant" | "system" | "developer";
  content: string | ResponseInputContent[];
  type?: "message";
}
```

#### ResponseFunctionToolCall

Passed back to continue a conversation after a function call:

```ts
{
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
  status?: "in_progress" | "completed" | "incomplete";
}
```

#### FunctionCallOutput

Provides the result of a function call:

```ts
{
  type: "function_call_output";
  call_id: string;
  output: string;
}
```

#### ResponseInputContent

```ts
type ResponseInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url?: string }   // not supported
  | { type: "input_file"; file_data?: string };    // not supported
```

Only `input_text` is supported. Other types log a warning and are skipped.

---

### Tool Types (Responses API)

#### FunctionTool

Flat format — `name` and `parameters` are top-level (not nested under `function`):

```ts
{
  type: "function";
  name: string;
  parameters: Record<string, unknown> | null;  // JSON Schema
  description?: string;
  strict?: boolean | null;
}
```

---

### Structured Output (Responses API)

#### ResponseTextConfig

```ts
{ format?: ResponseFormatConfig }
```

#### ResponseFormatConfig

```ts
type ResponseFormatConfig =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      description?: string;
      strict?: boolean | null;
    };
```

Only `json_schema` triggers constrained generation.

---

### Response Object

```ts
{
  id: string;                    // "resp_<uuid>"
  object: "response";
  created_at: number;            // Unix timestamp (seconds)
  model: string;                 // "SystemLanguageModel" or "PrivateCloudComputeLanguageModel" (never an alias)
  output: ResponseOutputItem[];
  output_text: string;           // convenience: concatenated text from output messages
  status: "completed" | "failed" | "incomplete";
  error: ResponseError | null;
  incomplete_details: { reason?: "max_output_tokens" | "content_filter" } | null;
  instructions: string | null;
  metadata: Record<string, string> | null;
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
  tool_choice: "none" | "auto" | "required" | { type: "function"; name: string };
  tools: FunctionTool[];
  parallel_tool_calls: boolean;
  text: ResponseTextConfig;
  truncation: "auto" | "disabled" | null;
  usage: ResponseUsage | null;   // null until completed, or if generation failed
}

// ResponseUsage
{
  input_tokens: number;
  input_tokens_details: { cached_tokens: number };
  output_tokens: number;
  output_tokens_details: { reasoning_tokens: number };
  total_tokens: number;
}
```

### ResponseOutputItem

```ts
type ResponseOutputItem = ResponseOutputMessage | ResponseOutputFunctionToolCall;
```

### ResponseOutputMessage

```ts
{
  id: string;
  type: "message";
  role: "assistant";
  status: "completed" | "incomplete" | "in_progress";
  content: Array<ResponseOutputText | ResponseOutputRefusal>;
}
```

### ResponseOutputText

```ts
{ type: "output_text"; text: string; annotations: unknown[] }
```

### ResponseOutputRefusal

```ts
{ type: "refusal"; refusal: string }
```

### ResponseOutputFunctionToolCall

```ts
{
  type: "function_call";
  id: string;
  call_id: string;              // use this in FunctionCallOutput
  name: string;
  arguments: string;            // JSON string
  status: "completed";
}
```

---

### ResponseStream

Async iterable wrapper for Responses API streaming events.

```ts
class ResponseStream implements AsyncIterable<ResponseStreamEvent>
```

| Method | Description |
| --- | --- |
| `[Symbol.asyncIterator]()` | Iterate events with `for await...of` |
| `close()` | Eagerly release resources |
| `toReadableStream()` | Convert to Web `ReadableStream<ResponseStreamEvent>` |

### ResponseStreamEvent

Union of all event types. See [Streaming Events](#streaming-events-reference) for the full list.

---

### Streaming Events Reference

| Event type | Key fields |
| --- | --- |
| `response.created` | `response: Response` |
| `response.in_progress` | `response: Response` |
| `response.completed` | `response: Response` |
| `response.failed` | `response: Response` |
| `response.incomplete` | `response: Response` |
| `response.output_item.added` | `item: ResponseOutputItem`, `output_index` |
| `response.output_item.done` | `item: ResponseOutputItem`, `output_index` |
| `response.content_part.added` | `part`, `item_id`, `output_index`, `content_index` |
| `response.content_part.done` | `part`, `item_id`, `output_index`, `content_index` |
| `response.output_text.delta` | `delta: string`, `item_id`, `output_index`, `content_index` |
| `response.output_text.done` | `text: string`, `item_id`, `output_index`, `content_index` |
| `response.refusal.delta` | `delta: string`, `item_id` |
| `response.refusal.done` | `refusal: string`, `item_id` |
| `response.function_call_arguments.delta` | `delta: string`, `item_id`, `output_index` |
| `response.function_call_arguments.done` | `arguments: string`, `name`, `call_id`, `item_id` |

All events include a `sequence_number` field.

---

## Chat Completions API

### Completions

Accessed via `client.chat.completions`.

#### `chat.completions.create(params)`

Creates a chat completion.

```ts
// Non-streaming
create(params: ChatCompletionCreateParams & { stream?: false | null }): Promise<ChatCompletion>

// Streaming
create(params: ChatCompletionCreateParams & { stream: true }): Promise<Stream>
```

---

## ChatCompletionCreateParams

Request parameters for `create()`.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `messages` | `ChatCompletionMessageParam[]` | Yes | Conversation messages |
| `model` | `string` | No | `"SystemLanguageModel"` (default) or `"PrivateCloudComputeLanguageModel"`; `"system"` and `"pcc"`, the ids Apple's `fm serve` uses, are aliases. Other names warn and use the on-device model. |
| `stream` | `boolean` | No | Enable streaming |
| `stream_options` | `{ include_usage?: boolean }` | No | With `include_usage`, the stream ends with a chunk that carries `usage` |
| `reasoning_effort` | `string` | No | Maps to `reasoningLevel` for Private Cloud Compute, and is ignored with a warning for the on-device model |
| `temperature` | `number` | No | Sampling temperature. Foundation Models accepts 0 to 1, so a value above 1 is clamped to 1 with a warning |
| `max_tokens` | `number` | No | Maximum response tokens |
| `max_completion_tokens` | `number` | No | Same as `max_tokens` (takes priority) |
| `top_p` | `number` | No | Probability threshold for sampling |
| `seed` | `number` | No | Random seed for reproducibility |
| `tools` | `ChatCompletionTool[]` | No | Tool definitions |
| `response_format` | `ResponseFormat` | No | Output format constraint |

All other Chat Completions parameters (`n`, `stop`, `logprobs`, `frequency_penalty`, `presence_penalty`, `logit_bias`, `tool_choice`, `parallel_tool_calls`, etc.) are accepted but ignored. A warning is logged at runtime for each unsupported parameter that has a non-null value.

---

## Message Types

### ChatCompletionMessageParam

Union of all message types:

```ts
type ChatCompletionMessageParam =
  | ChatCompletionSystemMessageParam
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam;
```

### ChatCompletionSystemMessageParam

```ts
{ role: "system"; content: string; name?: string }
```

### ChatCompletionDeveloperMessageParam

```ts
{ role: "developer"; content: string; name?: string }
```

### ChatCompletionUserMessageParam

```ts
{ role: "user"; content: string | ChatCompletionContentPart[]; name?: string }
```

### ChatCompletionAssistantMessageParam

```ts
{
  role: "assistant";
  content?: string | null;
  tool_calls?: ChatCompletionMessageToolCall[];
  refusal?: string | null;
  name?: string;
}
```

### ChatCompletionToolMessageParam

```ts
{ role: "tool"; content: string; tool_call_id: string }
```

### ChatCompletionContentPart

```ts
type ChatCompletionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { file_data: string; filename: string } }
  | { type: "refusal"; refusal: string };
```

Only `text` parts are supported. Other content types log a warning and are skipped.

---

## Tool Types

### ChatCompletionTool

```ts
{
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;  // JSON Schema
    strict?: boolean | null;
  };
}
```

### ChatCompletionMessageToolCall

```ts
{
  id: string;          // "call_<uuid>"
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}
```

---

## Response Format

### ResponseFormat

```ts
type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        description?: string;
        schema?: Record<string, unknown>;
        strict?: boolean | null;
      };
    };
```

Only `json_schema` triggers constrained generation. `text` and `json_object` are treated as plain text generation.

---

## Response Types

### ChatCompletion

```ts
{
  id: string;                    // "chatcmpl-<uuid>"
  object: "chat.completion";
  created: number;               // Unix timestamp (seconds)
  model: string;                 // "SystemLanguageModel" or "PrivateCloudComputeLanguageModel" (never an alias)
  choices: ChatCompletionChoice[];
  usage: CompletionUsage | null; // null if generation failed
  system_fingerprint: null;
}

// CompletionUsage
{
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details: { cached_tokens: number };
  completion_tokens_details: { reasoning_tokens: number };
}
```

### ChatCompletionChoice

```ts
{
  index: number;
  message: ChatCompletionMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
}
```

### ChatCompletionMessage

```ts
{
  role: "assistant";
  content: string | null;
  refusal: string | null;
  tool_calls?: ChatCompletionMessageToolCall[];
}
```

---

## Streaming Types

### Stream

Async iterable wrapper with resource cleanup.

```ts
class Stream implements AsyncIterable<ChatCompletionChunk>
```

| Method | Description |
| --- | --- |
| `[Symbol.asyncIterator]()` | Iterate chunks with `for await...of` |
| `close()` | Eagerly release resources |
| `toReadableStream()` | Convert to Web `ReadableStream<ChatCompletionChunk>` |

The stream auto-closes on iteration completion, `break`, or error. A `FinalizationRegistry` ensures cleanup if the stream is abandoned without being fully consumed.

### ChatCompletionChunk

```ts
{
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage: CompletionUsage | null; // only on the final chunk, with stream_options.include_usage
  system_fingerprint: null;
}
```

### ChatCompletionChunkDelta

```ts
{
  role?: "assistant";
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: { name?: string; arguments?: string };
  }>;
  refusal?: string | null;
}
```

---

## Constants

### MODEL_DEFAULT

```ts
const MODEL_DEFAULT = "SystemLanguageModel";
```

Placeholder model identifier for the on-device foundation model. It can be omitted since only one model is available.

---

## CompatError

Error class with an HTTP-style status code, thrown for `RateLimitedError` (status 429).

```ts
class CompatError extends Error {
  status: number;
}
```
