# Chat & Responses APIs

Examples using the Chat-style and Responses-style API interfaces at `tsfm-sdk/chat`. Both the Responses API and Chat Completions API are shown.

## Responses API

### Basic Text Generation

```ts
import Client from "tsfm-sdk/chat";

const client = new Client();

// String input — the simplest form
const response = await client.responses.create({
  instructions: "You are a helpful assistant. Be concise.",
  input: "What is the capital of France?",
});

console.log(response.output_text);
// "The capital of France is Paris."

client.close();
```

### Multi-turn Conversation

```ts
const response = await client.responses.create({
  instructions: "You are a math tutor. Be concise.",
  input: [
    { role: "user", content: "What is 2 + 2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "Multiply that by 3" },
  ],
});

console.log(response.output_text);
// "12"
```

### Streaming

```ts
const stream = await client.responses.create({
  input: "Count from 1 to 5, one per line.",
  stream: true,
});

for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}
console.log();
```

### Structured Output

```ts
const response = await client.responses.create({
  input: "Extract: Alice is 28 years old and lives in Seattle",
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
console.log(person);
// { name: "Alice", age: 28, city: "Seattle" }
```

### Tool Calling

```ts
const tools = [
  {
    type: "function" as const,
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
];

// Step 1: Model decides to call a tool
const response = await client.responses.create({
  input: "What's the weather in Tokyo?",
  tools,
});

const fc = response.output.find((item) => item.type === "function_call");

if (fc && fc.type === "function_call") {
  console.log("Tool:", fc.name);
  console.log("Args:", fc.arguments);

  // Step 2: Execute the tool and send results back
  const result = JSON.stringify({ temp: 22, condition: "Sunny" });

  const followUp = await client.responses.create({
    input: [
      { role: "user", content: "What's the weather in Tokyo?" },
      fc,  // pass the function_call back
      { type: "function_call_output", call_id: fc.call_id, output: result },
    ],
    tools,
  });

  console.log(followUp.output_text);
  // "It's currently 22°C and sunny in Tokyo."
}
```

### Generation Options

```ts
const response = await client.responses.create({
  input: "Write a creative haiku",
  temperature: 0.8,
  max_output_tokens: 50,
  seed: 42,
});

console.log(response.output_text);
```

### Handling Errors

```ts
const response = await client.responses.create({
  input: "...",
});

if (response.status === "incomplete") {
  console.log("Incomplete:", response.incomplete_details?.reason);
  // "max_output_tokens" or "content_filter"
}

// Check for refusals
for (const item of response.output) {
  if (item.type === "message") {
    for (const content of item.content) {
      if (content.type === "refusal") {
        console.log("Refused:", content.refusal);
      }
    }
  }
}
```

---

## Chat Completions API

### Chat: Basic Text Generation

```ts
import Client from "tsfm-sdk/chat";

const client = new Client();

const response = await client.chat.completions.create({
  messages: [
    { role: "system", content: "You are a helpful assistant. Be concise." },
    { role: "user", content: "What is the capital of France?" },
  ],
});

console.log(response.choices[0].message.content);
// "The capital of France is Paris."

client.close();
```

### Chat: Multi-turn Conversation

```ts
const response = await client.chat.completions.create({
  messages: [
    { role: "system", content: "You are a math tutor. Be concise." },
    { role: "user", content: "What is 2 + 2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "Multiply that by 3" },
  ],
});

console.log(response.choices[0].message.content);
// "12"
```

### Chat: Streaming

```ts
const stream = await client.chat.completions.create({
  messages: [{ role: "user", content: "Count from 1 to 5, one per line." }],
  stream: true,
});

for await (const chunk of stream) {
  const delta = chunk.choices[0].delta.content;
  if (delta) process.stdout.write(delta);
}
console.log();
```

### Chat: Structured Output

```ts
const response = await client.chat.completions.create({
  messages: [
    { role: "user", content: "Extract: Alice is 28 years old and lives in Seattle" },
  ],
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
console.log(person);
// { name: "Alice", age: 28, city: "Seattle" }
```

### Chat: Tool Calling

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

// Step 1: Model decides to call a tool
const response = await client.chat.completions.create({
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools,
});

const choice = response.choices[0];

if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
  const call = choice.message.tool_calls[0];
  console.log("Tool:", call.function.name);
  console.log("Args:", call.function.arguments);

  // Step 2: Execute the tool and send results back
  const result = JSON.stringify({ temp: 22, condition: "Sunny" });

  const followUp = await client.chat.completions.create({
    messages: [
      { role: "user", content: "What's the weather in Tokyo?" },
      { role: "assistant", content: null, tool_calls: [call] },
      { role: "tool", tool_call_id: call.id, content: result },
    ],
    tools,
  });

  console.log(followUp.choices[0].message.content);
  // "It's currently 22°C and sunny in Tokyo."
}
```
