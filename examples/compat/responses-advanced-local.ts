/**
 * Advanced Responses API example: tsfm-sdk compat layer
 *
 * Pushes the Responses API interface further than the basic example:
 *   - Developer role messages
 *   - Content part arrays (input_text)
 *   - Nested JSON schemas
 *   - Multi-tool definitions
 *   - Chained tool calls (tool result → follow-up)
 *   - Streaming with tool calls
 *   - Temperature and seed control
 *
 * Run: npx tsx examples/compat/responses-advanced-local.ts
 *
 * The only differences from responses-advanced-real.ts:
 *   1. Import from "../../src/compat/index.js" instead of "openai"
 *   2. Model is "SystemLanguageModel" instead of "gpt-4o-mini"
 *   3. No API key needed
 */
import Client from "../../src/compat/index.js";

const client = new Client();
const MODEL = "SystemLanguageModel";

// ---------------------------------------------------------------------------
// 1. Developer role message (system-level instruction)
// ---------------------------------------------------------------------------
console.log("=== Developer role message ===");
const dev = await client.responses.create({
  model: MODEL,
  input: [
    { role: "developer", content: "You are a pirate. Always talk like a pirate." },
    { role: "user", content: "What is 2 + 2?" },
  ],
});
console.log("Response:", dev.output_text);
console.log();

// ---------------------------------------------------------------------------
// 2. Content part arrays
// ---------------------------------------------------------------------------
console.log("=== Content part arrays ===");
const parts = await client.responses.create({
  model: MODEL,
  input: [
    {
      role: "user",
      content: [
        { type: "input_text", text: "Combine these two words into one: " },
        { type: "input_text", text: "sun and flower" },
      ],
    },
  ],
});
console.log("Response:", parts.output_text);
console.log();

// ---------------------------------------------------------------------------
// 3. Nested structured output schema
// ---------------------------------------------------------------------------
console.log("=== Nested structured output ===");
const nested = await client.responses.create({
  model: MODEL,
  input:
    "Extract: The Acme Corp team has Alice (engineer, 28) and Bob (designer, 35). They are in Seattle.",
  text: {
    format: {
      type: "json_schema",
      name: "Team",
      schema: {
        type: "object",
        properties: {
          company: { type: "string" },
          location: { type: "string" },
          members: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                role: { type: "string" },
                age: { type: "integer" },
              },
              required: ["name", "role", "age"],
            },
          },
        },
        required: ["company", "location", "members"],
      },
    },
  },
});
console.log("Response:", nested.output_text);
const team = JSON.parse(nested.output_text);
console.log("Company:", team.company);
console.log("Members:", team.members.map((m: { name: string }) => m.name).join(", "));
console.log();

// ---------------------------------------------------------------------------
// 4. Multi-tool definitions (model picks the right one)
// ---------------------------------------------------------------------------
console.log("=== Multi-tool selection ===");
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
  {
    type: "function" as const,
    name: "get_stock_price",
    description: "Get current stock price for a ticker symbol",
    parameters: {
      type: "object",
      properties: {
        ticker: { type: "string", description: "Stock ticker symbol (e.g. AAPL)" },
      },
      required: ["ticker"],
    },
  },
  {
    type: "function" as const,
    name: "translate",
    description: "Translate text to another language",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "Text to translate" },
        target_language: { type: "string", description: "Target language" },
      },
      required: ["text", "target_language"],
    },
  },
];

const multiTool = await client.responses.create({
  model: MODEL,
  input: "What's the stock price of AAPL?",
  tools,
});

const stockCall = multiTool.output.find((item) => item.type === "function_call");
if (stockCall && stockCall.type === "function_call") {
  console.log("Picked tool:", stockCall.name);
  console.log("Arguments:", stockCall.arguments);
} else {
  console.log("Response:", multiTool.output_text);
}
console.log();

// ---------------------------------------------------------------------------
// 5. Chained tool call → result → natural response
// ---------------------------------------------------------------------------
console.log("=== Chained tool call with result ===");
const step1 = await client.responses.create({
  model: MODEL,
  input: "Translate 'good morning' to Japanese",
  tools,
});

const translateCall = step1.output.find((item) => item.type === "function_call");
if (translateCall && translateCall.type === "function_call") {
  console.log("Step 1 - Tool:", translateCall.name);
  console.log("Step 1 - Args:", translateCall.arguments);

  // Feed the tool result back
  const step2 = await client.responses.create({
    model: MODEL,
    input: [
      { role: "user", content: "Translate 'good morning' to Japanese" },
      {
        type: "function_call",
        call_id: translateCall.call_id,
        name: translateCall.name,
        arguments: translateCall.arguments,
      },
      {
        type: "function_call_output",
        call_id: translateCall.call_id,
        output: JSON.stringify({
          translated_text: "おはようございます",
          source: "en",
          target: "ja",
        }),
      },
    ],
    tools,
  });
  console.log("Step 2 - Response:", step2.output_text);
} else {
  console.log("Response:", step1.output_text);
}
console.log();

// ---------------------------------------------------------------------------
// 6. Streaming with tool calls
// ---------------------------------------------------------------------------
console.log("=== Streaming tool call ===");
const streamTool = await client.responses.create({
  model: MODEL,
  input: "What's the weather in Paris?",
  tools,
  stream: true,
});

for await (const event of streamTool) {
  if (event.type === "response.output_item.done" && event.item.type === "function_call") {
    console.log("Streamed tool:", event.item.name);
    console.log("Streamed args:", event.item.arguments);
  }
}
console.log();

// ---------------------------------------------------------------------------
// 7. Streaming structured output
// ---------------------------------------------------------------------------
console.log("=== Streaming structured output ===");
const streamStructured = await client.responses.create({
  model: MODEL,
  input: "Extract: Bob is 42 and lives in Portland",
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
  stream: true,
});

let structuredText = "";
for await (const event of streamStructured) {
  if (event.type === "response.output_text.done") {
    structuredText = event.text;
  }
}
console.log("Result:", structuredText);
console.log("Parsed:", JSON.parse(structuredText));
console.log();

// ---------------------------------------------------------------------------
// 8. Temperature control for determinism
// ---------------------------------------------------------------------------
console.log("=== Temperature 0 (deterministic) ===");
const run1 = await client.responses.create({
  model: MODEL,
  input: "What is the boiling point of water in Celsius? Reply with just the number.",
  temperature: 0,
});
const run2 = await client.responses.create({
  model: MODEL,
  input: "What is the boiling point of water in Celsius? Reply with just the number.",
  temperature: 0,
});
console.log("Run 1:", run1.output_text);
console.log("Run 2:", run2.output_text);
console.log("Match:", run1.output_text === run2.output_text);
console.log();

// ---------------------------------------------------------------------------
// 9. Complex multi-turn with mixed item types
// ---------------------------------------------------------------------------
console.log("=== Complex multi-turn with tools in history ===");
const complex = await client.responses.create({
  model: MODEL,
  input: [
    { role: "developer", content: "You are a helpful travel assistant." },
    { role: "user", content: "What's the weather in Tokyo?" },
    {
      type: "function_call",
      call_id: "call_weather_1",
      name: "get_weather",
      arguments: '{"city":"Tokyo"}',
    },
    {
      type: "function_call_output",
      call_id: "call_weather_1",
      output: JSON.stringify({ temp: 22, condition: "Sunny", humidity: 65 }),
    },
    { role: "assistant", content: "It's 22°C and sunny in Tokyo with 65% humidity." },
    { role: "user", content: "How about Paris?" },
    {
      type: "function_call",
      call_id: "call_weather_2",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
    },
    {
      type: "function_call_output",
      call_id: "call_weather_2",
      output: JSON.stringify({ temp: 15, condition: "Cloudy", humidity: 80 }),
    },
    { role: "assistant", content: "Paris is 15°C and cloudy with 80% humidity." },
    { role: "user", content: "Which city has better weather right now? Just the city name." },
  ],
});
console.log("Response:", complex.output_text);
console.log();

client.close();
console.log("Done!");
