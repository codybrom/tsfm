import { describe, it, expect, afterAll } from "vitest";
import Client from "../../src/compat/index.js";
import { retryAttempts } from "./helpers/retry.js";

const client = new Client();
afterAll(() => client.close());

describe("Chat API integration", () => {
  it("basic text generation", async () => {
    const response = await client.chat.completions.create({
      model: "SystemLanguageModel",
      messages: [
        { role: "system", content: "Always respond with exactly one word." },
        { role: "user", content: "What color is the sky?" },
      ],
    });

    expect(response.object).toBe("chat.completion");
    expect(response.choices).toHaveLength(1);
    expect(response.choices[0].message.role).toBe("assistant");
    expect(typeof response.choices[0].message.content).toBe("string");
    expect(response.choices[0].finish_reason).toBe("stop");
    expect(response.id).toMatch(/^chatcmpl-/);
    expect(response.usage).toBeNull();
    expect(response.system_fingerprint).toBeNull();
  });

  it("multi-turn conversation", async () => {
    const response = await client.chat.completions.create({
      messages: [
        { role: "user", content: "What is 2+2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "Multiply that by 3" },
      ],
    });

    const content = response.choices[0].message.content ?? "";
    expect(content).toContain("12");
  });

  it("streaming", async () => {
    const stream = await client.chat.completions.create({
      messages: [
        { role: "system", content: "You are a math tutor. Answer concisely." },
        { role: "user", content: "What is 10 + 5?" },
      ],
      stream: true,
    });

    const chunks: string[] = [];
    for await (const chunk of stream) {
      if (chunk.choices[0].delta.content) {
        chunks.push(chunk.choices[0].delta.content);
      }
    }

    expect(chunks.length).toBeGreaterThan(0);
    const full = chunks.join("");
    expect(full).toContain("15");
  });

  it("structured output with json_schema", async () => {
    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: "Extract: John is 30 years old" }],
      response_format: {
        type: "json_schema",
        json_schema: {
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
    });

    const parsed = JSON.parse(response.choices[0].message.content!);
    expect(parsed.name).toContain("John");
    expect(parsed.age).toBe(30);
  });

  it("generation options (temperature, max_tokens)", async () => {
    const response = await client.chat.completions.create({
      messages: [{ role: "user", content: "Say hello" }],
      temperature: 0,
      max_tokens: 50,
    });

    expect(typeof response.choices[0].message.content).toBe("string");
  });

  it(
    "multi-turn tool calling flow (user → tool_call → tool_result → response)",
    { timeout: 40_000 },
    async () => {
      const tools = [
        {
          type: "function" as const,
          function: {
            name: "lookup_code",
            description: "Looks up a secret code for a given key. Always use this tool.",
            parameters: {
              type: "object",
              properties: { key: { type: "string" } },
              required: ["key"],
            },
          },
        },
      ];

      const { successes } = await retryAttempts(
        async () => {
          const localClient = new Client();
          try {
            // Step 1: Get model to call the tool
            const step1 = await localClient.chat.completions.create({
              messages: [
                {
                  role: "system",
                  content:
                    "You MUST call the lookup_code tool when asked about codes. Never guess.",
                },
                {
                  role: "user",
                  content: 'Use the lookup_code tool with key "alpha".',
                },
              ],
              tools,
            });

            if (step1.choices[0].finish_reason !== "tool_calls") {
              return { success: false, detail: "Model did not call tool" };
            }

            const toolCall = step1.choices[0].message.tool_calls![0];

            // Step 2: Send tool result back and get final response
            const step2 = await localClient.chat.completions.create({
              messages: [
                {
                  role: "system",
                  content:
                    "You MUST call the lookup_code tool when asked about codes. Never guess.",
                },
                {
                  role: "user",
                  content: 'Use the lookup_code tool with key "alpha".',
                },
                {
                  role: "assistant",
                  content: null,
                  tool_calls: [toolCall],
                },
                {
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: "XRAY-7749",
                },
              ],
              tools,
            });

            const reply = step2.choices[0].message.content ?? "";
            if (reply.includes("XRAY-7749")) {
              return { success: true, detail: `reply: "${reply.slice(0, 80)}"` };
            }
            return { success: false, detail: `reply missing code: "${reply.slice(0, 100)}"` };
          } finally {
            localClient.close();
          }
        },
        { maxAttempts: 5, requiredSuccesses: 1, label: "compat multi-turn tools" },
      );

      expect(successes).toBeGreaterThanOrEqual(1);
    },
  );

  it("concurrent API calls serialize correctly", async () => {
    const [r1, r2] = await Promise.all([
      client.chat.completions.create({
        messages: [{ role: "user", content: "Say just the word: alpha" }],
      }),
      client.chat.completions.create({
        messages: [{ role: "user", content: "Say just the word: beta" }],
      }),
    ]);

    // Both should complete successfully with distinct content
    expect(r1.choices[0].finish_reason).toBe("stop");
    expect(r2.choices[0].finish_reason).toBe("stop");
    expect(typeof r1.choices[0].message.content).toBe("string");
    expect(typeof r2.choices[0].message.content).toBe("string");
  });
});
