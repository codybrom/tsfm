import { describe, it, expect, afterAll } from "vitest";
import Client from "../../src/compat/index.js";
import type { Response, ResponseStreamEvent } from "../../src/compat/responses-types.js";

const client = new Client();
afterAll(() => client.close());

describe("Responses API — side-by-side with Chat Completions", () => {
  // -----------------------------------------------------------------------
  // Basic text generation
  // -----------------------------------------------------------------------

  it("both APIs produce text for a simple prompt", async () => {
    const [chat, responses] = await Promise.all([
      client.chat.completions.create({
        model: "SystemLanguageModel",
        messages: [
          { role: "system", content: "Always respond with exactly one word." },
          { role: "user", content: "What color is the sky?" },
        ],
      }),
      client.responses.create({
        instructions: "Always respond with exactly one word.",
        input: "What color is the sky?",
      }),
    ]);

    // Chat Completions shape
    expect(chat.object).toBe("chat.completion");
    expect(chat.choices).toHaveLength(1);
    expect(chat.choices[0].message.role).toBe("assistant");
    expect(typeof chat.choices[0].message.content).toBe("string");
    expect(chat.choices[0].finish_reason).toBe("stop");

    // Responses shape
    expect(responses.object).toBe("response");
    expect(responses.output).toHaveLength(1);
    expect(responses.output[0].type).toBe("message");
    expect(responses.status).toBe("completed");
    expect(typeof responses.output_text).toBe("string");
    expect(responses.output_text.length).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // Multi-turn conversation
  // -----------------------------------------------------------------------

  it("both APIs handle multi-turn correctly", async () => {
    const [chat, responses] = await Promise.all([
      client.chat.completions.create({
        messages: [
          { role: "user", content: "What is 2+2?" },
          { role: "assistant", content: "4" },
          { role: "user", content: "Multiply that by 3" },
        ],
      }),
      client.responses.create({
        input: [
          { role: "user", content: "What is 2+2?" },
          { role: "assistant", content: "4" },
          { role: "user", content: "Multiply that by 3" },
        ],
      }),
    ]);

    const chatContent = chat.choices[0].message.content ?? "";
    expect(chatContent).toContain("12");

    expect(responses.output_text).toContain("12");
  });

  // -----------------------------------------------------------------------
  // Streaming
  // -----------------------------------------------------------------------

  it("both APIs stream text", async () => {
    const prompt = "What is 10 + 5?";
    const system = "You are a math tutor. Answer concisely.";

    const [chatStream, responsesStream] = await Promise.all([
      client.chat.completions.create({
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        stream: true,
      }),
      client.responses.create({
        instructions: system,
        input: prompt,
        stream: true,
      }),
    ]);

    // Collect Chat Completions chunks
    const chatChunks: string[] = [];
    for await (const chunk of chatStream) {
      if (chunk.choices[0].delta.content) {
        chatChunks.push(chunk.choices[0].delta.content);
      }
    }
    const chatFull = chatChunks.join("");

    // Collect Responses stream events
    const responsesDeltas: string[] = [];
    const eventTypes = new Set<string>();
    for await (const event of responsesStream) {
      eventTypes.add(event.type);
      if (event.type === "response.output_text.delta") {
        responsesDeltas.push(event.delta);
      }
    }
    const responsesFull = responsesDeltas.join("");

    // Both should mention 15
    expect(chatFull).toContain("15");
    expect(responsesFull).toContain("15");

    // Chat Completions streams chunks
    expect(chatChunks.length).toBeGreaterThan(0);

    // Responses stream emits the proper lifecycle events
    expect(eventTypes).toContain("response.created");
    expect(eventTypes).toContain("response.in_progress");
    expect(eventTypes).toContain("response.output_text.delta");
    expect(eventTypes).toContain("response.output_text.done");
    expect(eventTypes).toContain("response.completed");
  });

  // -----------------------------------------------------------------------
  // Structured output
  // -----------------------------------------------------------------------

  it("both APIs produce structured output from the same schema", async () => {
    const schema = {
      type: "object" as const,
      properties: {
        name: { type: "string" },
        age: { type: "integer" },
      },
      required: ["name", "age"],
    };

    const [chat, responses] = await Promise.all([
      client.chat.completions.create({
        messages: [{ role: "user", content: "Extract: John is 30 years old" }],
        response_format: {
          type: "json_schema",
          json_schema: { name: "Person", schema },
        },
      }),
      client.responses.create({
        input: "Extract: John is 30 years old",
        text: {
          format: {
            type: "json_schema",
            name: "Person",
            schema,
          },
        },
      }),
    ]);

    const chatParsed = JSON.parse(chat.choices[0].message.content!);
    expect(chatParsed.name).toContain("John");
    expect(chatParsed.age).toBe(30);

    const responsesParsed = JSON.parse(responses.output_text);
    expect(responsesParsed.name).toContain("John");
    expect(responsesParsed.age).toBe(30);
  });

  // -----------------------------------------------------------------------
  // Generation options
  // -----------------------------------------------------------------------

  it("both APIs accept temperature and max tokens", async () => {
    const [chat, responses] = await Promise.all([
      client.chat.completions.create({
        messages: [{ role: "user", content: "Say hello" }],
        temperature: 0,
        max_tokens: 50,
      }),
      client.responses.create({
        input: "Say hello",
        temperature: 0,
        max_output_tokens: 50,
      }),
    ]);

    expect(typeof chat.choices[0].message.content).toBe("string");
    expect(typeof responses.output_text).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Responses-only tests (features unique to the Responses API shape)
// ---------------------------------------------------------------------------

describe("Responses API — standalone", () => {
  it("response object has correct shape", async () => {
    const response = await client.responses.create({
      input: "Hello",
    });

    expect(response.id).toMatch(/^resp_/);
    expect(response.object).toBe("response");
    expect(typeof response.created_at).toBe("number");
    expect(response.model).toBe("SystemLanguageModel");
    expect(response.status).toBe("completed");
    expect(response.error).toBeNull();
    expect(response.incomplete_details).toBeNull();
    expect(response.usage).toBeNull();
    expect(response.tools).toEqual([]);
  });

  it("string input produces a text response", async () => {
    const response = await client.responses.create({
      input: "Say the word hello.",
    });

    expect(response.status).toBe("completed");
    expect(response.output).toHaveLength(1);
    expect(response.output[0].type).toBe("message");
    expect(response.output_text.length).toBeGreaterThan(0);
  });

  it("instructions are reflected in the response object", async () => {
    const response = await client.responses.create({
      instructions: "Always respond with exactly one word.",
      input: "Say hello",
    });

    expect(response.instructions).toBe("Always respond with exactly one word.");
    expect(response.status).toBe("completed");
    expect(response.output_text.length).toBeGreaterThan(0);
  });

  it("streaming yields sequential sequence_numbers", async () => {
    const stream = await client.responses.create({
      input: "Count to 3",
      stream: true,
    });

    const seqNums: number[] = [];
    let lastResponse: Response | null = null;

    for await (const event of stream) {
      seqNums.push(event.sequence_number);
      if (event.type === "response.completed") {
        lastResponse = event.response;
      }
    }

    // Sequence numbers are sequential starting from 0
    for (let i = 0; i < seqNums.length; i++) {
      expect(seqNums[i]).toBe(i);
    }

    // Final event has the completed response
    expect(lastResponse).not.toBeNull();
    expect(lastResponse!.status).toBe("completed");
    expect(lastResponse!.output).toHaveLength(1);
    expect(lastResponse!.output_text.length).toBeGreaterThan(0);
  });

  it("streaming structured output works", async () => {
    const stream = await client.responses.create({
      input: "Extract: Alice is 25",
      text: {
        format: {
          type: "json_schema",
          name: "Person",
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" },
            },
            required: ["name", "age"],
          },
        },
      },
      stream: true,
    });

    const events: ResponseStreamEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    // Should have lifecycle events
    const types = events.map((e) => e.type);
    expect(types[0]).toBe("response.created");
    expect(types[1]).toBe("response.in_progress");
    expect(types[types.length - 1]).toBe("response.completed");

    // The completed response should have valid JSON
    const completed = events.find((e) => e.type === "response.completed");
    expect(completed).toBeDefined();
    const response = (completed as { response: Response }).response;
    const parsed = JSON.parse(response.output_text);
    expect(parsed.name).toContain("Alice");
    expect(parsed.age).toBe(25);
  });
});
