/**
 * Responses API example: Real OpenAI SDK
 *
 * Requires OPENAI_API_KEY in .env.local
 *
 * Run: npx tsx --env-file=.env.local examples/compat/responses-real.ts
 */
import OpenAI from "openai";

const client = new OpenAI();

// ---------------------------------------------------------------------------
// 1. Basic text generation
// ---------------------------------------------------------------------------
console.log("=== Basic text generation ===");
const basic = await client.responses.create({
  model: "gpt-4o-mini",
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
  model: "gpt-4o-mini",
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
  model: "gpt-4o-mini",
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
  model: "gpt-4o-mini",
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
  model: "gpt-4o-mini",
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
        additionalProperties: false,
      },
      strict: true,
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
  model: "gpt-4o-mini",
  input: "What's the weather in Tokyo?",
  tools: [
    {
      type: "function",
      strict: null,
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
    model: "gpt-4o-mini",
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
        strict: null,
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

console.log("Done!");
