/**
 * Responses API example: tsfm-sdk compat layer
 *
 * Run: npx tsx examples/compat/responses-local.ts
 *
 * The only differences from responses-real.ts:
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
const basic = await client.responses.create({
  model: "SystemLanguageModel",
  input: "What is the capital of France? Be concise.",
});
console.log("Response:", basic.output_text);
console.log("Status:", basic.status);
console.log();

// ---------------------------------------------------------------------------
// 2. Instructions
// ---------------------------------------------------------------------------
console.log("=== Instructions ===");
const instr = await client.responses.create({
  model: "SystemLanguageModel",
  instructions: "You are a math tutor. Be concise.",
  input: "What is 2 + 2?",
});
console.log("Response:", instr.output_text);
console.log();

// ---------------------------------------------------------------------------
// 3. Multi-turn conversation
// ---------------------------------------------------------------------------
console.log("=== Multi-turn conversation ===");
const multi = await client.responses.create({
  model: "SystemLanguageModel",
  input: [
    { role: "user", content: "What is 2 + 2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "Multiply that by 3" },
  ],
});
console.log("Response:", multi.output_text);
console.log();

// ---------------------------------------------------------------------------
// 4. Streaming
// ---------------------------------------------------------------------------
console.log("=== Streaming ===");
const stream = await client.responses.create({
  model: "SystemLanguageModel",
  input: "Count from 1 to 5, one per line.",
  stream: true,
});
process.stdout.write("Response: ");
for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.delta);
  }
}
console.log("\n");

// ---------------------------------------------------------------------------
// 5. Structured output
// ---------------------------------------------------------------------------
console.log("=== Structured output ===");
const structured = await client.responses.create({
  model: "SystemLanguageModel",
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
console.log("Response:", structured.output_text);
console.log("Parsed:", JSON.parse(structured.output_text));
console.log();

// ---------------------------------------------------------------------------
// 6. Tool calling
// ---------------------------------------------------------------------------
console.log("=== Tool calling ===");
const toolCall = await client.responses.create({
  model: "SystemLanguageModel",
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

const fc = toolCall.output.find((item) => item.type === "function_call");
if (fc && fc.type === "function_call") {
  console.log("Tool called:", fc.name);
  console.log("Arguments:", fc.arguments);

  // Send tool result back
  const followUp = await client.responses.create({
    model: "SystemLanguageModel",
    input: [
      { role: "user", content: "What's the weather in Tokyo?" },
      { type: "function_call", call_id: fc.call_id, name: fc.name, arguments: fc.arguments },
      {
        type: "function_call_output",
        call_id: fc.call_id,
        output: JSON.stringify({ temp: 22, condition: "Sunny" }),
      },
    ],
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
  console.log("Follow-up:", followUp.output_text);
} else {
  console.log("Response:", toolCall.output_text);
}
console.log();

client.close();
console.log("Done!");
