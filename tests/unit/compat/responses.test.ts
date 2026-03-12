import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "../helpers/mock-bindings.js";

// ---------------------------------------------------------------------------
// Hoisted mocks — must run before any import
// ---------------------------------------------------------------------------

const { decodeAndFreeStringMock } = vi.hoisted(() => {
  globalThis.FinalizationRegistry = class MockFinalizationRegistry {
    constructor(_callback: unknown) {}
    register() {}
    unregister() {}
  } as unknown as typeof FinalizationRegistry;

  return {
    decodeAndFreeStringMock: vi.fn((_pointer: unknown): string | null => {
      if (!_pointer) return null;
      return '{"key":"value"}';
    }),
  };
});

const mockFns = createMockFunctions();

let lastRegisteredCallback: ((...args: unknown[]) => void) | null = null;

vi.mock("koffi", () => ({
  default: {
    register: vi.fn((cb: (...args: unknown[]) => void, _proto: unknown) => {
      lastRegisteredCallback = cb;
      return "mock-cb-pointer";
    }),
    unregister: vi.fn(),
    as: vi.fn((_arr: unknown[], _type: string) => "mock-arr-pointer"),
    pointer: vi.fn((_proto: unknown) => "mock-proto-pointer"),
  },
}));

vi.mock("../../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeAndFreeString: decodeAndFreeStringMock,
  unregisterCallback: vi.fn(),
  ResponseCallbackProto: "ResponseCallbackProto",
  StructuredResponseCallbackProto: "StructuredResponseCallbackProto",
}));

vi.mock("../../../src/tool.js", () => ({
  Tool: class MockTool {
    _nativeTool = "mock-tool-pointer";
    _register() {}
  },
}));

import Client from "../../../src/compat/index.js";
import type {
  Response,
  ResponseStreamEvent,
  ResponseOutputMessage,
  ResponseOutputFunctionToolCall,
} from "../../../src/compat/responses-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simulateRespondSuccess(text: string) {
  mockFns.FMLanguageModelSessionRespond.mockImplementation((..._args: unknown[]) => {
    setTimeout(() => {
      lastRegisteredCallback?.(0, text, text.length, null);
    }, 0);
    return "mock-task-pointer";
  });
}

function simulateRespondError(status: number, msg: string) {
  mockFns.FMLanguageModelSessionRespond.mockImplementation((..._args: unknown[]) => {
    setTimeout(() => {
      lastRegisteredCallback?.(status, msg, msg.length, null);
    }, 0);
    return "mock-task-pointer";
  });
}

function simulateStreamSuccess(chunks: string[]) {
  mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
    (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
      let cumulative = "";
      let i = 0;
      function next() {
        if (i < chunks.length) {
          cumulative += chunks[i];
          i++;
          setTimeout(() => {
            lastRegisteredCallback?.(0, cumulative, cumulative.length, null);
            next();
          }, 0);
        } else {
          setTimeout(() => {
            lastRegisteredCallback?.(0, null, 0, null);
          }, 0);
        }
      }
      next();
    },
  );
}

function simulateStructuredSuccess(jsonObj: Record<string, unknown>) {
  const jsonStr = JSON.stringify(jsonObj);
  mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
    (..._args: unknown[]) => {
      setTimeout(() => {
        lastRegisteredCallback?.(0, "mock-content-pointer", null);
      }, 0);
      return "mock-task-pointer";
    },
  );
  mockFns.FMGeneratedContentGetJSONString.mockReturnValue("mock-json-pointer");
  decodeAndFreeStringMock.mockImplementation((pointer: unknown) => {
    if (!pointer) return null;
    return jsonStr;
  });
}

function simulateStreamError(status: number, msg: string) {
  mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
    (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
      setTimeout(() => {
        lastRegisteredCallback?.(status, msg, msg.length, null);
      }, 0);
    },
  );
}

const sampleFunctionTools = [
  {
    type: "function" as const,
    name: "get_weather",
    description: "Get weather",
    parameters: { type: "object", properties: { city: { type: "string" } } },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  lastRegisteredCallback = null;
  decodeAndFreeStringMock.mockImplementation((_pointer: unknown): string | null => {
    if (!_pointer) return null;
    return '{"key":"value"}';
  });
});

describe("Responses API compat layer", () => {
  describe("structure", () => {
    it("has responses.create method", () => {
      const client = new Client();
      expect(client.responses).toBeDefined();
      expect(typeof client.responses.create).toBe("function");
      client.close();
    });
  });

  describe("create — string input", () => {
    it("returns correct Response shape for simple string input", async () => {
      simulateRespondSuccess("Hello from Apple Intelligence");

      const client = new Client();
      const result = (await client.responses.create({
        input: "Hello",
      })) as Response;

      expect(result.object).toBe("response");
      expect(result.model).toBe("SystemLanguageModel");
      expect(result.status).toBe("completed");
      expect(result.id).toMatch(/^resp_/);
      expect(result.output).toHaveLength(1);
      expect(result.output[0].type).toBe("message");
      const msg = result.output[0] as ResponseOutputMessage;
      expect(msg.role).toBe("assistant");
      expect(msg.status).toBe("completed");
      expect(msg.content).toHaveLength(1);
      expect(msg.content[0].type).toBe("output_text");
      expect((msg.content[0] as { type: "output_text"; text: string }).text).toBe(
        "Hello from Apple Intelligence",
      );
      expect(result.output_text).toBe("Hello from Apple Intelligence");
      expect(result.error).toBeNull();
      expect(result.incomplete_details).toBeNull();
      expect(result.usage).toBeNull();
      client.close();
    });
  });

  describe("create — array input with messages", () => {
    it("returns response for array input with user message", async () => {
      simulateRespondSuccess("Hi there");

      const client = new Client();
      const result = (await client.responses.create({
        input: [{ role: "user", content: "Hello" }],
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("Hi there");
      client.close();
    });

    it("throws when input array has no user message", async () => {
      const client = new Client();
      await expect(
        client.responses.create({
          input: [{ role: "assistant", content: "I am assistant" }],
        }),
      ).rejects.toThrow("at least one user message");
      client.close();
    });

    it("handles input_text content parts in array messages", async () => {
      simulateRespondSuccess("Got it");

      const client = new Client();
      const result = (await client.responses.create({
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "Hello " },
              { type: "input_text", text: "world" },
            ],
          },
        ],
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("Got it");
      client.close();
    });

    it("warns on unsupported content part types", async () => {
      simulateRespondSuccess("ok");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.responses.create({
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "hello" },
              { type: "input_image", image_url: "http://example.com/img.png" } as never,
            ],
          },
        ],
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("input_image"));
      warnSpy.mockRestore();
      client.close();
    });
  });

  describe("instructions parameter", () => {
    it("injects instructions into transcript", async () => {
      simulateRespondSuccess("Sure!");

      const client = new Client();
      await client.responses.create({
        input: "Hello",
        instructions: "Be concise.",
      });

      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalled();
      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instrEntry = parsed.transcript.entries.find(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instrEntry).toBeDefined();
      expect(instrEntry.contents[0].text).toContain("Be concise.");
      client.close();
    });

    it("reflects instructions in response object", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      const result = (await client.responses.create({
        input: "Hi",
        instructions: "Be helpful.",
      })) as Response;

      expect(result.instructions).toBe("Be helpful.");
      client.close();
    });
  });

  describe("multi-turn conversations", () => {
    it("handles user/assistant turns in array input", async () => {
      simulateRespondSuccess("The capital of France is Paris.");

      const client = new Client();
      const result = (await client.responses.create({
        input: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello! How can I help?" },
          { role: "user", content: "What is the capital of France?" },
        ],
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("The capital of France is Paris.");
      client.close();
    });

    it("handles system/developer messages in array input", async () => {
      simulateRespondSuccess("Done");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
        ],
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instrEntry = parsed.transcript.entries.find(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instrEntry).toBeDefined();
      expect(instrEntry.contents[0].text).toContain("You are helpful.");
      client.close();
    });
  });

  describe("parameter mapping", () => {
    it("passes temperature through to options", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      const result = (await client.responses.create({
        input: "test",
        temperature: 0.7,
      })) as Response;

      expect(result.temperature).toBe(0.7);
      client.close();
    });

    it("passes max_output_tokens through", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      const result = (await client.responses.create({
        input: "test",
        max_output_tokens: 100,
      })) as Response;

      expect(result.max_output_tokens).toBe(100);
      client.close();
    });

    it("passes top_p and seed through", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      const result = (await client.responses.create({
        input: "test",
        top_p: 0.9,
        seed: 42,
      })) as Response;

      expect(result.top_p).toBe(0.9);
      client.close();
    });
  });

  describe("unsupported param warnings", () => {
    it("warns on unsupported model name", async () => {
      simulateRespondSuccess("test");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.responses.create({
        input: "test",
        model: "gpt-4o",
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("gpt-4o"));
      warnSpy.mockRestore();
      client.close();
    });

    it("warns on unsupported parameters", async () => {
      simulateRespondSuccess("test");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.responses.create({
        input: "test",
        store: true,
        user: "user-123",
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"store"'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"user"'));
      warnSpy.mockRestore();
      client.close();
    });

    it("warns when tool_choice is set to a non-auto value", async () => {
      simulateRespondSuccess("test");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.responses.create({
        input: "test",
        tool_choice: "required",
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"tool_choice" value "required"'),
      );
      warnSpy.mockRestore();
      client.close();
    });

    it("warns when tool_choice is set to an object value", async () => {
      simulateRespondSuccess("test");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.responses.create({
        input: "test",
        tool_choice: { type: "function", name: "my_func" },
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"tool_choice" value "object"'));
      warnSpy.mockRestore();
      client.close();
    });

    it("does not warn when tool_choice is auto", async () => {
      simulateRespondSuccess("test");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.responses.create({
        input: "test",
        tool_choice: "auto",
      });

      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining("tool_choice"));
      warnSpy.mockRestore();
      client.close();
    });
  });

  describe("response object structure", () => {
    it("includes all expected top-level fields", async () => {
      simulateRespondSuccess("Hello");

      const client = new Client();
      const result = (await client.responses.create({
        input: "Hi",
        instructions: "Be nice",
        temperature: 0.5,
        top_p: 0.9,
        max_output_tokens: 200,
      })) as Response;

      expect(result.id).toMatch(/^resp_/);
      expect(result.object).toBe("response");
      expect(typeof result.created_at).toBe("number");
      expect(result.model).toBe("SystemLanguageModel");
      expect(result.status).toBe("completed");
      expect(result.error).toBeNull();
      expect(result.incomplete_details).toBeNull();
      expect(result.instructions).toBe("Be nice");
      expect(result.temperature).toBe(0.5);
      expect(result.top_p).toBe(0.9);
      expect(result.max_output_tokens).toBe(200);
      expect(result.tool_choice).toBe("auto");
      expect(result.tools).toEqual([]);
      expect(result.parallel_tool_calls).toBe(false);
      expect(result.text).toEqual({ format: { type: "text" } });
      expect(result.truncation).toBeNull();
      expect(result.usage).toBeNull();
      expect(result.metadata).toBeNull();
      client.close();
    });

    it("disposes session after successful create", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      await client.responses.create({ input: "test" });

      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });

    it("disposes session even on error", async () => {
      simulateRespondError(7, "Rate limited");

      const client = new Client();
      await expect(client.responses.create({ input: "test" })).rejects.toThrow();

      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });
  });

  describe("structured output via text.format with json_schema", () => {
    it("returns parsed JSON as output_text", async () => {
      simulateStructuredSuccess({ name: "Alice", age: 25 });

      const client = new Client();
      const result = (await client.responses.create({
        input: "Generate a person",
        text: {
          format: {
            type: "json_schema",
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      })) as Response;

      expect(result.status).toBe("completed");
      const parsed = JSON.parse(result.output_text);
      expect(parsed.name).toBe("Alice");
      expect(parsed.age).toBe(25);
      client.close();
    });

    it("reorders JSON keys to match schema property order", async () => {
      simulateStructuredSuccess({ age: 30, name: "Bob" });

      const client = new Client();
      const result = (await client.responses.create({
        input: "Generate",
        text: {
          format: {
            type: "json_schema",
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      })) as Response;

      expect(result.output_text).toBe('{"name":"Bob","age":30}');
      client.close();
    });

    it("falls back to { type: 'object' } schema when schema is omitted", async () => {
      simulateStructuredSuccess({ answer: 42 });

      const client = new Client();
      const result = (await client.responses.create({
        input: "test",
        text: {
          format: {
            type: "json_schema",
            name: "Bare",
          } as never,
        },
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBeDefined();
      client.close();
    });
  });

  describe("tool calling (function tools)", () => {
    it("returns function_call output item when model calls a tool", async () => {
      simulateStructuredSuccess({
        type: "tool_call",
        tool_call: { name: "get_weather", arguments: { city: "SF" } },
      });

      const client = new Client();
      const result = (await client.responses.create({
        input: [{ role: "user", content: "What is the weather in SF?" }],
        tools: sampleFunctionTools,
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output).toHaveLength(1);
      const fc = result.output[0] as ResponseOutputFunctionToolCall;
      expect(fc.type).toBe("function_call");
      expect(fc.name).toBe("get_weather");
      expect(fc.arguments).toBe('{"city":"SF"}');
      expect(fc.call_id).toMatch(/^call_/);
      expect(fc.id).toMatch(/^fc_/);
      expect(fc.status).toBe("completed");
      // output_text should be empty for tool calls
      expect(result.output_text).toBe("");
      client.close();
    });

    it("returns text when model responds with text despite tools", async () => {
      simulateStructuredSuccess({ type: "text", content: "I can help with that" });

      const client = new Client();
      const result = (await client.responses.create({
        input: [{ role: "user", content: "Hello" }],
        tools: sampleFunctionTools,
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("I can help with that");
      const msg = result.output[0] as ResponseOutputMessage;
      expect(msg.type).toBe("message");
      client.close();
    });

    it("returns empty string content when model text response has no content field", async () => {
      simulateStructuredSuccess({ type: "text" });

      const client = new Client();
      const result = (await client.responses.create({
        input: [{ role: "user", content: "Hello" }],
        tools: sampleFunctionTools,
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("");
      client.close();
    });

    it("injects tool instructions when no system message exists", async () => {
      simulateStructuredSuccess({ type: "text", content: "ok" });

      const client = new Client();
      await client.responses.create({
        input: [{ role: "user", content: "Hello" }],
        tools: sampleFunctionTools,
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instrEntry = parsed.transcript.entries.find(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instrEntry).toBeDefined();
      expect(instrEntry.contents[0].text).toContain("get_weather");
      client.close();
    });

    it("appends tool instructions to existing instructions", async () => {
      simulateStructuredSuccess({ type: "text", content: "ok" });

      const client = new Client();
      await client.responses.create({
        input: [{ role: "user", content: "Hello" }],
        instructions: "Be helpful.",
        tools: sampleFunctionTools,
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instrEntry = parsed.transcript.entries.find(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instrEntry.contents[0].text).toContain("Be helpful.");
      expect(instrEntry.contents[0].text).toContain("get_weather");
      client.close();
    });
  });

  describe("tool results (function_call_output in input)", () => {
    it("uses plain text respond when last input is function_call_output", async () => {
      simulateRespondSuccess("The weather in SF is sunny.");

      const client = new Client();
      const result = (await client.responses.create({
        input: [
          { role: "user", content: "What's the weather?" },
          {
            type: "function_call",
            name: "get_weather",
            arguments: '{"city":"SF"}',
            call_id: "call_1",
          },
          {
            type: "function_call_output",
            call_id: "call_1",
            output: "Sunny, 72F",
          },
        ],
        tools: sampleFunctionTools,
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("The weather in SF is sunny.");
      // Should NOT have any function_call items since tool result flow uses plain respond
      const msg = result.output[0] as ResponseOutputMessage;
      expect(msg.type).toBe("message");
      client.close();
    });

    it("includes tool result text in the synthetic user message", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "user", content: "Get weather" },
          {
            type: "function_call",
            name: "get_weather",
            arguments: '{"city":"NYC"}',
            call_id: "call_2",
          },
          {
            type: "function_call_output",
            call_id: "call_2",
            output: "Rainy, 55F",
          },
        ],
        tools: sampleFunctionTools,
      });

      // The prompt should include the tool result text
      const respondArgs = mockFns.FMLanguageModelSessionRespond.mock.calls[0];
      const prompt = respondArgs[1] as string;
      expect(prompt).toContain("Tool result");
      expect(prompt).toContain("Rainy, 55F");
      client.close();
    });
  });

  describe("error mapping — non-streaming", () => {
    it("returns incomplete status with error for ExceededContextWindowSizeError", async () => {
      simulateRespondError(1, "Context window exceeded");

      const client = new Client();
      const result = (await client.responses.create({ input: "test" })) as Response;

      expect(result.status).toBe("incomplete");
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe("max_output_tokens");
      expect(result.error!.message).toContain("Context window exceeded");
      expect(result.incomplete_details).toEqual({ reason: "max_output_tokens" });
      client.close();
    });

    it("returns refusal content for RefusalError", async () => {
      simulateRespondError(9, "Model refused");

      const client = new Client();
      const result = (await client.responses.create({ input: "test" })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output).toHaveLength(1);
      const msg = result.output[0] as ResponseOutputMessage;
      expect(msg.content[0].type).toBe("refusal");
      expect((msg.content[0] as { type: "refusal"; refusal: string }).refusal).toContain("refused");
      client.close();
    });

    it("re-throws RateLimitedError with status 429", async () => {
      simulateRespondError(7, "Rate limited");

      const client = new Client();
      try {
        await client.responses.create({ input: "test" });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as { status: number }).status).toBe(429);
      }
      client.close();
    });

    it("returns failed with content_filter error for GuardrailViolationError", async () => {
      simulateRespondError(3, "Guardrail violation");

      const client = new Client();
      const result = (await client.responses.create({ input: "test" })) as Response;

      expect(result.status).toBe("failed");
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe("content_filter");
      expect(result.error!.message).toContain("Guardrail violation");
      expect(result.incomplete_details).toEqual({ reason: "content_filter" });
      expect(result.output).toEqual([]);
      client.close();
    });

    it("re-throws unhandled errors directly", async () => {
      simulateRespondError(2, "Assets unavailable");

      const client = new Client();
      await expect(client.responses.create({ input: "test" })).rejects.toThrow(
        "Assets unavailable",
      );
      client.close();
    });
  });

  describe("streaming — text deltas and event types", () => {
    it("returns a ResponseStream instance", async () => {
      simulateStreamSuccess(["Hello", " world"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      expect(stream).toBeDefined();
      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }
      expect(events.length).toBeGreaterThan(0);
      client.close();
    });

    it("emits response.created and response.in_progress first", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      expect(events[0].type).toBe("response.created");
      expect(events[1].type).toBe("response.in_progress");
      client.close();
    });

    it("emits text delta events during streaming", async () => {
      simulateStreamSuccess(["Hello", " world"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hi",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const deltas = events.filter((e) => e.type === "response.output_text.delta");
      expect(deltas.length).toBeGreaterThan(0);

      const textDone = events.find((e) => e.type === "response.output_text.done");
      expect(textDone).toBeDefined();
      client.close();
    });

    it("emits response.completed as final event", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const last = events[events.length - 1];
      expect(last.type).toBe("response.completed");
      client.close();
    });

    it("emits sequence_numbers in order", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      for (let i = 0; i < events.length; i++) {
        expect(events[i].sequence_number).toBe(i);
      }
      client.close();
    });

    it("emits output_item.added, content_part.added, and output_item.done", async () => {
      simulateStreamSuccess(["Test"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hi",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("response.output_item.added");
      expect(types).toContain("response.content_part.added");
      expect(types).toContain("response.content_part.done");
      expect(types).toContain("response.output_item.done");
      client.close();
    });
  });

  describe("streaming — tools", () => {
    it("emits function_call events when model calls a tool", async () => {
      simulateStructuredSuccess({
        type: "tool_call",
        tool_call: { name: "get_weather", arguments: { city: "NYC" } },
      });

      const client = new Client();
      const stream = await client.responses.create({
        input: [{ role: "user", content: "Weather?" }],
        tools: sampleFunctionTools,
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("response.output_item.added");
      expect(types).toContain("response.function_call_arguments.delta");
      expect(types).toContain("response.function_call_arguments.done");
      expect(types).toContain("response.output_item.done");
      expect(types).toContain("response.completed");

      const argsDone = events.find((e) => e.type === "response.function_call_arguments.done");
      expect(argsDone).toBeDefined();
      if (argsDone?.type === "response.function_call_arguments.done") {
        expect(argsDone.name).toBe("get_weather");
        expect(argsDone.arguments).toBe('{"city":"NYC"}');
      }
      client.close();
    });

    it("emits text events when model responds with text despite tools", async () => {
      simulateStructuredSuccess({ type: "text", content: "No tool needed" });

      const client = new Client();
      const stream = await client.responses.create({
        input: [{ role: "user", content: "Hello" }],
        tools: sampleFunctionTools,
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const textDelta = events.find(
        (e) =>
          e.type === "response.output_text.delta" && "delta" in e && e.delta === "No tool needed",
      );
      expect(textDelta).toBeDefined();

      const last = events[events.length - 1];
      expect(last.type).toBe("response.completed");
      client.close();
    });
  });

  describe("streaming — structured output", () => {
    it("buffers structured output and emits text events", async () => {
      simulateStructuredSuccess({ name: "Alice", age: 25 });

      const client = new Client();
      const stream = await client.responses.create({
        input: "Generate",
        stream: true,
        text: {
          format: {
            type: "json_schema",
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const types = events.map((e) => e.type);
      expect(types).toContain("response.output_text.delta");
      expect(types).toContain("response.output_text.done");
      expect(types).toContain("response.completed");
      client.close();
    });
  });

  describe("streaming — error handling", () => {
    it("emits response.incomplete with error for ExceededContextWindowSizeError", async () => {
      simulateStreamError(1, "Context window exceeded");

      const client = new Client();
      const stream = await client.responses.create({
        input: "test",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const last = events[events.length - 1];
      expect(last.type).toBe("response.incomplete");
      if (last.type === "response.incomplete") {
        expect(last.response.status).toBe("incomplete");
        expect(last.response.error).toBeDefined();
        expect(last.response.error!.code).toBe("max_output_tokens");
        expect(last.response.error!.message).toContain("Context window exceeded");
        expect(last.response.incomplete_details).toEqual({ reason: "max_output_tokens" });
      }
      client.close();
    });

    it("emits refusal via response.completed for RefusalError", async () => {
      simulateStreamError(9, "Model refused");

      const client = new Client();
      const stream = await client.responses.create({
        input: "test",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const last = events[events.length - 1];
      expect(last.type).toBe("response.completed");
      if (last.type === "response.completed") {
        const msg = last.response.output[0] as ResponseOutputMessage;
        expect(msg.content[0].type).toBe("refusal");
      }
      client.close();
    });

    it("throws CompatError with status 429 for RateLimitedError", async () => {
      simulateStreamError(7, "Rate limited");

      const client = new Client();
      const stream = await client.responses.create({
        input: "test",
        stream: true,
      });

      try {
        for await (const _event of stream) {
          // consume
        }
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as { status: number }).status).toBe(429);
      }
      client.close();
    });

    it("emits response.failed with content_filter error for GuardrailViolationError", async () => {
      simulateStreamError(3, "Guardrail violation");

      const client = new Client();
      const stream = await client.responses.create({
        input: "test",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const last = events[events.length - 1];
      expect(last.type).toBe("response.failed");
      if (last.type === "response.failed") {
        expect(last.response.status).toBe("failed");
        expect(last.response.error).toBeDefined();
        expect(last.response.error!.code).toBe("content_filter");
        expect(last.response.error!.message).toContain("Guardrail violation");
        expect(last.response.incomplete_details).toEqual({ reason: "content_filter" });
      }
      client.close();
    });

    it("re-throws unhandled errors during streaming", async () => {
      simulateStreamError(2, "Assets unavailable");

      const client = new Client();
      const stream = await client.responses.create({
        input: "test",
        stream: true,
      });

      await expect(async () => {
        for await (const _event of stream) {
          // consume
        }
      }).rejects.toThrow("Assets unavailable");
      client.close();
    });
  });

  describe("edge cases — coverage branches", () => {
    it("handles multiple contiguous function_call_output items", async () => {
      simulateRespondSuccess("Both results processed");

      const client = new Client();
      const result = (await client.responses.create({
        input: [
          { role: "user", content: "Get data" },
          {
            type: "function_call",
            name: "tool_a",
            arguments: "{}",
            call_id: "call_a",
          },
          {
            type: "function_call",
            name: "tool_b",
            arguments: "{}",
            call_id: "call_b",
          },
          {
            type: "function_call_output",
            call_id: "call_a",
            output: "Result A",
          },
          {
            type: "function_call_output",
            call_id: "call_b",
            output: "Result B",
          },
        ],
      })) as Response;

      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("Both results processed");
      client.close();
    });

    it("handles duplicate system/developer messages (second becomes user entry)", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "system", content: "First system" },
          { role: "developer", content: "Second system" },
          { role: "user", content: "Hello" },
        ],
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instrEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instrEntries).toHaveLength(1);
      expect(instrEntries[0].contents[0].text).toContain("First system");
      // Second system/developer should be a user entry with [System] prefix
      const userEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "user",
      );
      const systemUser = userEntries.find((e: { contents: { text: string }[] }) =>
        e.contents[0].text.includes("[System]"),
      );
      expect(systemUser).toBeDefined();
      expect(systemUser.contents[0].text).toContain("Second system");
      client.close();
    });

    it("handles function_call_output with unresolvable call_id", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "user", content: "Do something" },
          {
            type: "function_call_output",
            call_id: "nonexistent_id",
            output: "Some result",
          },
        ],
      });

      const respondArgs = mockFns.FMLanguageModelSessionRespond.mock.calls[0];
      const prompt = respondArgs[1] as string;
      expect(prompt).toContain("[Tool result]:");
      expect(prompt).not.toContain("[Tool result for ");
      client.close();
    });

    it("handles instructions + system message in array input (instructions param takes priority)", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "system", content: "System instruction" },
          { role: "user", content: "Hello" },
        ],
        instructions: "Top-level instruction",
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      // instructions param creates the instructions entry
      const instrEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instrEntries).toHaveLength(1);
      expect(instrEntries[0].contents[0].text).toContain("Top-level instruction");
      // system message should become a [System] user entry
      const userEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "user",
      );
      const systemUser = userEntries.find((e: { contents: { text: string }[] }) =>
        e.contents[0].text.includes("[System]"),
      );
      expect(systemUser).toBeDefined();
      client.close();
    });

    it("reorderJson handles invalid JSON gracefully", async () => {
      // Return invalid JSON from the structured response to trigger catch branch
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-pointer", null);
          }, 0);
          return "mock-task-pointer";
        },
      );
      mockFns.FMGeneratedContentGetJSONString.mockReturnValue("mock-json-pointer");
      decodeAndFreeStringMock.mockImplementation((pointer: unknown) => {
        if (!pointer) return null;
        return "not valid json {{{";
      });

      const client = new Client();
      const result = (await client.responses.create({
        input: "Generate",
        text: {
          format: {
            type: "json_schema",
            name: "Test",
            schema: {
              type: "object",
              properties: { a: { type: "string" } },
            },
          },
        },
      })) as Response;

      // Should fall through with the raw string instead of crashing
      expect(result.status).toBe("completed");
      expect(result.output_text).toBe("not valid json {{{");
      client.close();
    });

    it("function_call items in input become response transcript entries", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "user", content: "Get weather" },
          {
            type: "function_call",
            name: "get_weather",
            arguments: '{"city":"LA"}',
            call_id: "call_fc",
          },
          {
            type: "function_call_output",
            call_id: "call_fc",
            output: "Sunny",
          },
        ],
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const responseEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "response",
      );
      expect(responseEntries.length).toBeGreaterThan(0);
      client.close();
    });
  });

  describe("branch coverage — remaining paths", () => {
    it("function_call_output mid-array (not trailing) enters else-if branch", async () => {
      simulateRespondSuccess("Done");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "user", content: "Do A" },
          {
            type: "function_call",
            name: "tool_a",
            arguments: "{}",
            call_id: "call_mid",
          },
          {
            type: "function_call_output",
            call_id: "call_mid",
            output: "Result mid",
          },
          { role: "user", content: "Now do B" },
        ],
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      // The function_call_output should appear as a user entry with [Tool result for ...]
      const userEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "user",
      );
      const toolResult = userEntries.find((e: { contents: { text: string }[] }) =>
        e.contents[0].text.includes("[Tool result"),
      );
      expect(toolResult).toBeDefined();
      expect(toolResult.contents[0].text).toContain("Result mid");
      client.close();
    });

    it("maps top_p only (without seed) to sampling mode", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      await client.responses.create({
        input: "test",
        top_p: 0.8,
      });

      // Verify the call went through (sampling mode set internally)
      expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled();
      client.close();
    });

    it("maps seed only (without top_p) to sampling mode", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      await client.responses.create({
        input: "test",
        seed: 123,
      });

      expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled();
      client.close();
    });

    it("handles tool with null parameters", async () => {
      simulateStructuredSuccess({ type: "text", content: "hi" });

      const client = new Client();
      await client.responses.create({
        input: [{ role: "user", content: "test" }],
        tools: [
          {
            type: "function" as const,
            name: "noop",
            description: "Does nothing",
            parameters: null,
          },
        ],
      });

      expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).toHaveBeenCalled();
      client.close();
    });

    it("reorderJson handles extra keys not in schema and missing keys", async () => {
      // Return object with an extra key not in schema + schema key missing from object
      simulateStructuredSuccess({ name: "Alice", extra_field: "bonus" });

      const client = new Client();
      const result = (await client.responses.create({
        input: "Generate",
        text: {
          format: {
            type: "json_schema",
            name: "Person",
            schema: {
              type: "object",
              properties: {
                name: { type: "string" },
                age: { type: "integer" }, // missing from response
              },
            },
          },
        },
      })) as Response;

      const parsed = JSON.parse(result.output_text);
      // name should come first (from schema order), extra_field should follow
      expect(Object.keys(parsed)).toEqual(["name", "extra_field"]);
      expect(parsed.name).toBe("Alice");
      expect(parsed.extra_field).toBe("bonus");
      client.close();
    });

    it("reorderJson handles non-object/array values and schemas without properties", async () => {
      // Return an array value — orderKeys should pass it through
      simulateStructuredSuccess({ items: [1, 2, 3], value: null });

      const client = new Client();
      const result = (await client.responses.create({
        input: "Generate",
        text: {
          format: {
            type: "json_schema",
            name: "Test",
            schema: {
              type: "object",
              properties: {
                items: { type: "array" },
                value: { type: "string" },
              },
            },
          },
        },
      })) as Response;

      const parsed = JSON.parse(result.output_text);
      expect(parsed.items).toEqual([1, 2, 3]);
      expect(parsed.value).toBeNull();
      client.close();
    });

    it("handles assistant messages in multi-turn array input", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello there" },
          { role: "user", content: "Thanks" },
        ],
      });

      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const responseEntries = parsed.transcript.entries.filter(
        (e: { role: string }) => e.role === "response",
      );
      expect(responseEntries).toHaveLength(1);
      expect(responseEntries[0].contents[0].text).toBe("Hello there");
      client.close();
    });

    it("includes assistant messages in transcript", async () => {
      simulateRespondSuccess("reply");

      const client = new Client();
      const response = await client.responses.create({
        input: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello!" },
          { role: "user", content: "How are you?" },
        ],
      });

      expect(response.output).toHaveLength(1);
      expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled();
      const prompt = mockFns.FMLanguageModelSessionRespond.mock.calls[0][1] as string;
      expect(prompt).toBe("How are you?");
      client.close();
    });

    it("silently skips messages with unrecognized roles", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { role: "tool" as never, content: "ignored" },
          { role: "user", content: "Hello" },
        ],
      });

      expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled();
      client.close();
    });

    it("ignores unknown item types in input array", async () => {
      simulateRespondSuccess("OK");

      const client = new Client();
      await client.responses.create({
        input: [
          { type: "some_unknown_type", data: "ignored" } as never,
          { role: "user", content: "Hello" },
        ],
      });

      // Should not throw, unknown items are silently skipped
      expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled();
      client.close();
    });

    it("streaming structured output with schema omitted falls back to { type: 'object' }", async () => {
      simulateStructuredSuccess({ value: 42 });

      const client = new Client();
      const stream = await client.responses.create({
        input: "test",
        stream: true,
        text: {
          format: {
            type: "json_schema",
            name: "Bare",
          } as never,
        },
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const last = events[events.length - 1];
      expect(last.type).toBe("response.completed");
      client.close();
    });

    it("streaming refusal emits response.completed with refusal content", async () => {
      simulateStreamError(9, "I cannot do that");

      const client = new Client();
      const stream = await client.responses.create({
        input: "bad request",
        stream: true,
      });

      const events: ResponseStreamEvent[] = [];
      for await (const event of stream) {
        events.push(event);
      }

      const completed = events.find((e) => e.type === "response.completed");
      expect(completed).toBeDefined();
      if (completed?.type === "response.completed") {
        const msg = completed.response.output[0] as ResponseOutputMessage;
        expect(msg.content[0].type).toBe("refusal");
      }
      client.close();
    });
  });

  describe("ResponseStream close() and cleanup", () => {
    it("stream.close() disposes the session", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      mockFns.FMRelease.mockClear();
      stream.close();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });

    it("stream.close() is idempotent", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      mockFns.FMRelease.mockClear();
      stream.close();
      stream.close();
      // FMRelease for session should only be called once
      expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
      client.close();
    });

    it("session is cleaned up after full iteration", async () => {
      simulateStreamSuccess(["Hello"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hi",
        stream: true,
      });

      for await (const _event of stream) {
        // consume all events
      }

      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });

    it("toReadableStream() returns a ReadableStream that yields events", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      const readable = stream.toReadableStream();
      expect(readable).toBeInstanceOf(ReadableStream);

      const reader = readable.getReader();
      const events: ResponseStreamEvent[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        events.push(value);
      }
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].type).toBe("response.created");
      client.close();
    });

    it("break during iteration calls cleanup via return()", async () => {
      simulateStreamSuccess(["a", "b", "c"]);

      const client = new Client();
      const stream = await client.responses.create({
        input: "Hello",
        stream: true,
      });

      mockFns.FMRelease.mockClear();
      for await (const _event of stream) {
        break;
      }

      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });
  });
});
