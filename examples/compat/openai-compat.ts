/**
 * Side-by-side example: tsfm-sdk Chat API compatibility layer
 *
 * Run: npx tsx examples/compat/openai-compat.ts
 *
 * The only differences from openai-real.ts:
 *   1. Import from "../../src/compat/index.js" instead of "openai"
 *   2. No model parameter needed (uses on-device Apple Intelligence)
 *   3. No API key needed
 */
import Client from "../../src/compat/index.js";

const client = new Client();

// ---------------------------------------------------------------------------
// 1. Basic text generation
// ---------------------------------------------------------------------------
console.log("=== Basic text generation ===");
const basic = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [
    { role: "system", content: "You are a helpful assistant. Be concise." },
    { role: "user", content: "What is the capital of France?" },
  ],
});
console.log("Response:", basic.choices[0].message.content);
console.log("Finish reason:", basic.choices[0].finish_reason);
console.log();

// ---------------------------------------------------------------------------
// 2. Multi-turn conversation
// ---------------------------------------------------------------------------
console.log("=== Multi-turn conversation ===");
const multi = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [
    { role: "system", content: "You are a math tutor. Be concise." },
    { role: "user", content: "What is 2 + 2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "Multiply that by 3" },
  ],
});
console.log("Response:", multi.choices[0].message.content);
console.log();

// ---------------------------------------------------------------------------
// 3. Streaming
// ---------------------------------------------------------------------------
console.log("=== Streaming ===");
const stream = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [{ role: "user", content: "Count from 1 to 5, one per line." }],
  stream: true,
});
process.stdout.write("Response: ");
for await (const chunk of stream) {
  const delta = chunk.choices[0].delta.content;
  if (delta) process.stdout.write(delta);
}
console.log("\n");

// ---------------------------------------------------------------------------
// 4. Structured output (JSON schema)
// ---------------------------------------------------------------------------
console.log("=== Structured output ===");
const structured = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [{ role: "user", content: "Extract: Alice is 28 years old and lives in Seattle" }],
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
console.log("Response:", structured.choices[0].message.content);
console.log("Parsed:", JSON.parse(structured.choices[0].message.content!));
console.log();

// ---------------------------------------------------------------------------
// 5. Tool calling
// ---------------------------------------------------------------------------
console.log("=== Tool calling ===");
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

const toolCall = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [{ role: "user", content: "What's the weather in Tokyo?" }],
  tools,
});

const choice = toolCall.choices[0];
if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
  const call = choice.message.tool_calls[0];
  console.log("Tool called:", call.function.name);
  console.log("Arguments:", call.function.arguments);

  // Simulate tool result and continue
  const followUp = await client.chat.completions.create({
    model: "SystemLanguageModel",
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
  console.log("Follow-up:", followUp.choices[0].message.content);
} else {
  console.log("Response:", choice.message.content);
}
console.log();

// ---------------------------------------------------------------------------
// 6. Generation options
// ---------------------------------------------------------------------------
console.log("=== Generation options ===");
const opts = await client.chat.completions.create({
  model: "SystemLanguageModel",
  messages: [{ role: "user", content: "Say hello" }],
  temperature: 0,
  max_tokens: 20,
});
console.log("Response:", opts.choices[0].message.content);
console.log();

client.close();
console.log("Done!");
