# Chat & Responses APIs

TSFM ships Chat-style and Responses-style API interfaces at `tsfm-sdk/chat`. It supports both `responses.create()` and `chat.completions.create()` so you can swap in on-device Apple Intelligence with minimal code changes.

```ts
import Client from "tsfm-sdk/chat";

const client = new Client();

// Responses API (recommended)
const response = await client.responses.create({
  model: "SystemLanguageModel",
  instructions: "You are a helpful assistant.",
  input: "What is the capital of France?",
});
console.log(response.output_text);

// Chat Completions API
const completion = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "What is the capital of France?" },
  ],
});
console.log(completion.choices[0].message.content);

client.close();
```

If you've used the OpenAI Node SDK or similar APIs, the interface should feel familiar. The biggest difference is that the `model` param can be omitted or set to `"SystemLanguageModel"`

## What TSFM Supports

Both APIs support the same core capabilities:

| Feature | Responses API | Chat Completions API | tsfm Support |
| --- | --- | --- | --- |
| Text generation | `input: "..."` | `messages: [...]` | Full |
| Multi-turn conversations | `input: [...]` (message array) | `messages: [...]` | Full |
| Streaming | `stream: true` | `stream: true` | Full |
| Structured output | `text: { format: { type: "json_schema" } }` | `response_format: { type: "json_schema" }` | Full |
| Tool calling | `tools: [{ type: "function", name, ... }]` | `tools: [{ type: "function", function: { name, ... } }]` | Full |
| `temperature`, `max_output_tokens` | `temperature`, `max_output_tokens` | `temperature`, `max_tokens` / `max_completion_tokens` | Full |
| `top_p`, `seed` | `top_p`, `seed` | `top_p`, `seed` | Full |
| Image/audio content | `input_image`, `input_file` | Image URLs | Not supported (warns) |
| `usage` / token counts | `usage` | `usage` | Always `null` |

---

## Responses API

The Responses-style API uses a `client.responses.create()` function with a simpler input model and richer output structure.

### Basic Usage

The simplest `responses.create()` call takes a string `input`:

```ts
const response = await client.responses.create({
  input: "What is the capital of France?",
});

// Outputs are available on the response object
console.log(response.output_text); 
```

### Instructions

In the Responses API, system instructions are a top-level parameter rather than a message role:

```ts
const response = await client.responses.create({
  instructions: "You are a concise math tutor.",
  input: "What is 2 + 2?",
});
```

### Multi-turn Conversations

For multi-turn conversations with `responses.create()`, pass an array of input items:

```ts
const response = await client.responses.create({
  instructions: "You are a math tutor.",
  input: [
    { role: "user", content: "What is 2 + 2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "Multiply that by 3" },
  ],
});
```

### Streaming

Pass `stream: true` to `responses.create()` to get a `ResponseStream` of typed events:

```ts
const stream = await client.responses.create({
  input: "Tell me a story",
  stream: true,
});

for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}
```

Key event types:

| Event type | Description |
| --- | --- |
| `response.created` | Response object created |
| `response.in_progress` | Generation started |
| `response.output_item.added` | New output item (message or function call) |
| `response.output_text.delta` | Text token |
| `response.output_text.done` | Full text complete |
| `response.function_call_arguments.delta` | Function arguments chunk |
| `response.function_call_arguments.done` | Full function call complete |
| `response.output_item.done` | Output item complete |
| `response.completed` | Full response complete |
| `response.incomplete` | Generation stopped early |

::: warning
When streaming structured output or tool calls, the full response is generated before any events are emitted. This is because Foundation Models uses constrained generation (a grammar that forces valid JSON), which cannot be interrupted mid-token. Plain text generation is the only mode that streams incrementally as tokens are produced.
:::

### Structured Output

The Responses API uses `text.format` with `type: "json_schema"` for structured output:

```ts
const response = await client.responses.create({
  input: "Extract: Alice is 28 and lives in Seattle",
  text: {
    format: {
      type: "json_schema",
      name: "Person",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
          city: { type: "string" },
        },
        required: ["name", "age", "city"],
      },
    },
  },
});

const person = JSON.parse(response.output_text);
// { name: "Alice", age: 28, city: "Seattle" }
```

### Tool Calling

The Responses API uses a flat tool format with `name` and `parameters` at the top level (not nested under `function` like Chat Completions):

```ts
const response = await client.responses.create({
  input: "What's the weather in Tokyo?",
  tools: [
    {
      type: "function",
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
        },
        required: ["city"],
      },
    },
  ],
});

// Check for function calls in the output
for (const item of response.output) {
  if (item.type === "function_call") {
    console.log(item.name);      // "get_weather"
    console.log(item.arguments); // '{"city":"Tokyo"}'
    console.log(item.call_id);   // "call_<uuid>" — use this to send results back
  }
}
```

### Sending Tool Results Back

Send results using `function_call_output` input items. Pass back the original `function_call` item alongside its output:

```ts
const fc = response.output.find((item) => item.type === "function_call")!;

const followUp = await client.responses.create({
  input: [
    { role: "user", content: "What's the weather in Tokyo?" },
    fc,  // pass the function_call back
    {
      type: "function_call_output",
      call_id: fc.call_id,
      output: JSON.stringify({ temp: 22, condition: "Sunny" }),
    },
  ],
  tools: [/* same tools */],
});

console.log(followUp.output_text);
// "It's currently 22°C and sunny in Tokyo."
```

### Generation Options

```ts
const response = await client.responses.create({
  input: "Write a creative haiku",
  temperature: 0.8,
  max_output_tokens: 50,
  seed: 42,
});
```

### Error Mapping

| Native error | Responses API equivalent |
| --- | --- |
| `ExceededContextWindowSizeError` | `status: "incomplete"`, `incomplete_details.reason: "max_output_tokens"` |
| `RefusalError` | Output contains `{ type: "refusal", refusal: "..." }` |
| `GuardrailViolationError` | `status: "incomplete"`, `incomplete_details.reason: "content_filter"` |
| `RateLimitedError` | Thrown as error with status `429` |

### Response Object

```ts
{
  id: "resp_...",
  object: "response",
  created_at: 1710000000,
  model: "SystemLanguageModel",
  output: [
    {
      id: "msg_...",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "...", annotations: [] }]
    }
  ],
  output_text: "...",              // convenience: concatenated text
  status: "completed",            // "completed" | "failed" | "incomplete"
  error: null,
  incomplete_details: null,        // { reason: "max_output_tokens" | "content_filter" }
  instructions: "...",
  usage: null                      // not tracked
}
```

---

## Chat Completions API

The Chat Completions API uses the classic `client.chat.completions.create()` interface.

### Messages

The Chat Completions API accepts all standard message roles:

| Role | Behavior |
| --- | --- |
| `system` | Mapped to the session's `instructions`. Only the first system message becomes instructions — subsequent ones are treated as user messages with a `[System]` prefix. |
| `developer` | Same as `system`. |
| `user` | Mapped to a user transcript entry. The last user message becomes the prompt. |
| `assistant` | Mapped to a response transcript entry. Tool calls are preserved. |
| `tool` | Mapped to a user message formatted as `[Tool result for toolName]: content`. |

#### Chat: Multi-turn Conversations

Pass the full conversation history in the `messages` array. The client converts it to a native Foundation Models [transcript](/guide/transcripts) behind the scenes — each `create()` call builds a fresh session from the messages you provide.

```ts
const response = await client.chat.completions.create({
  messages: [
    { role: "system", content: "You are a math tutor." },
    { role: "user", content: "What is 2 + 2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "Multiply that by 3" },
  ],
});
```

### Chat: Streaming

Pass `stream: true` to get an async iterable of `ChatCompletionChunk` objects:

```ts
const stream = await client.chat.completions.create({
  messages: [{ role: "user", content: "Tell me a story" }],
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0].delta.content;
  if (delta) process.stdout.write(delta);
}
```

The `Stream` object supports:

- **`for await...of`** — iterates chunks, auto-closes on completion or `break`
- **`stream.close()`** — eagerly release resources without finishing iteration
- **`stream.toReadableStream()`** — convert to a Web `ReadableStream` for HTTP responses

::: warning
Structured output and tool call responses are buffered — the model must finish constrained generation before the response is emitted. Only plain text streams token-by-token.
:::

### Chat: Structured Output

Use `response_format` with `type: "json_schema"` to get guaranteed JSON output:

```ts
const response = await client.chat.completions.create({
  messages: [{ role: "user", content: "Extract: Alice is 28 and lives in Seattle" }],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "Person",
      schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "integer" },
          city: { type: "string" },
        },
        required: ["name", "age", "city"],
      },
    },
  },
});

const person = JSON.parse(response.choices[0].message.content!);
// { name: "Alice", age: 28, city: "Seattle" }
```

The JSON schema is converted to Apple's native generation schema format at runtime. The model uses constrained sampling to guarantee valid output — no retry or validation needed.

### Chat: Tool Calling

Define tools using the standard function tool format:

```ts
const tools = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Get current weather for a city",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string", description: "City name" },
        },
        required: ["city"],
      },
    },
  },
];

const response = await client.chat.completions.create({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools,
});
```

When the model decides to call a tool, the response has `finish_reason: "tool_calls"` and `message.tool_calls` contains the calls:

```ts
const choice = response.choices[0];
if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
  const call = choice.message.tool_calls[0];
  console.log(call.function.name);      // "get_weather"
  console.log(call.function.arguments); // '{"city":"Tokyo"}'
}
```

#### Chat: Sending Tool Results Back

After executing the tool, send the result back with a follow-up request that includes the full conversation:

```ts
const followUp = await client.chat.completions.create({
  messages: [
    { role: "user", content: "What's the weather in Tokyo?" },
    { role: "assistant", content: null, tool_calls: [call] },
    {
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify({ temp: 22, condition: "Sunny" }),
    },
  ],
  tools,
});

console.log(followUp.choices[0].message.content);
// "It's currently 22°C and sunny in Tokyo."
```

::: info
Under the hood, tool calling uses structured output with a discriminated schema. The model chooses between `"text"` and `"tool_call"` as the first generated token, then fills in the tool name and arguments. Tools are suppressed when the last message is a tool result to prevent the model from re-calling the same tool.
:::

### Chat: Generation Options

| Param | Maps to |
| --- | --- |
| `temperature` | `GenerationOptions.temperature` |
| `max_tokens` / `max_completion_tokens` | `GenerationOptions.maximumResponseTokens` (`max_completion_tokens` takes priority) |
| `top_p` | `SamplingMode.random({ probabilityThreshold })` |
| `seed` | `SamplingMode.random({ seed })` |

```ts
const response = await client.chat.completions.create({
  messages: [{ role: "user", content: "Say hello" }],
  temperature: 0,
  max_tokens: 50,
  seed: 42,
});
```

## Chat Completions Error Mapping

| Native error | Chat Completions equivalent |
| --- | --- |
| `ExceededContextWindowSizeError` | `finish_reason: "length"` |
| `RefusalError` | `message.refusal` set, `content: null` |
| `GuardrailViolationError` | `finish_reason: "content_filter"` |
| `RateLimitedError` | Thrown as error with status `429` |

## Chat Completions Response Format

```ts
{
  id: "chatcmpl-...",           // Unique ID
  object: "chat.completion",    // Or "chat.completion.chunk" for streaming
  created: 1710000000,          // Unix timestamp (seconds)
  model: "SystemLanguageModel",
  choices: [{
    index: 0,
    message: {
      role: "assistant",
      content: "...",           // null when tool_calls present
      refusal: null,            // Set on RefusalError
      tool_calls: [...]         // Present when finish_reason is "tool_calls"
    },
    finish_reason: "stop"       // "stop" | "length" | "tool_calls" | "content_filter"
  }],
  usage: null,                  // Not tracked
  system_fingerprint: null
}
```

---

## Cleanup

Call `client.close()` when you're done to release the native model pointer:

```ts
const client = new Client();
// ... use client ...
client.close();
```

Each `create()` call manages its own session lifecycle internally — sessions are created from the messages array and disposed after the response completes (or after streaming finishes).

## What's Next

- [Structured Output](/guide/structured-output) — Schema-based generation with the native SDK
- [Tools](/guide/tools) — Native tool calling with the `Tool` class
- [Streaming](/guide/streaming) — Native streaming API
- [Error Handling](/guide/error-handling) — Full error reference
