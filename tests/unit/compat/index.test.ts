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

import Client, { MODEL_DEFAULT } from "../../../src/compat/index.js";
import type { ChatCompletionChunk } from "../../../src/compat/types.js";

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

const basicMessages = [{ role: "user" as const, content: "Hello" }];

const sampleTools = [
  {
    type: "function" as const,
    function: {
      name: "get_weather",
      description: "Get weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
    },
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

describe("Chat API compat layer", () => {
  describe("exports", () => {
    it("exports MODEL_DEFAULT constant", () => {
      expect(MODEL_DEFAULT).toBe("SystemLanguageModel");
    });

    it("default export is the Client class", () => {
      const client = new Client();
      expect(client).toBeInstanceOf(Client);
      client.close();
    });
  });

  describe("structure", () => {
    it("has chat.completions.create method", () => {
      const client = new Client();
      expect(client.chat).toBeDefined();
      expect(client.chat.completions).toBeDefined();
      expect(typeof client.chat.completions.create).toBe("function");
      client.close();
    });
  });

  describe("create — non-streaming", () => {
    it("throws on empty messages", async () => {
      const client = new Client();
      await expect(client.chat.completions.create({ messages: [] })).rejects.toThrow(
        "messages array must not be empty",
      );
      client.close();
    });

    it("returns correct ChatCompletion shape", async () => {
      simulateRespondSuccess("Hello from Apple Intelligence");

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
      });

      expect(result.object).toBe("chat.completion");
      expect(result.model).toBe("SystemLanguageModel");
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].index).toBe(0);
      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.choices[0].message.role).toBe("assistant");
      expect(result.choices[0].message.content).toBe("Hello from Apple Intelligence");
      expect(result.choices[0].message.refusal).toBeNull();
      expect(result.id).toMatch(/^chatcmpl-/);
      expect(result.usage).toBeNull();
      expect(result.system_fingerprint).toBeNull();
      client.close();
    });

    it("disposes session after successful create", async () => {
      simulateRespondSuccess("test");

      const client = new Client();
      await client.chat.completions.create({ messages: basicMessages });

      // Session dispose calls FMRelease on the session pointer
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });

    it("disposes session even on error", async () => {
      // Status 7 = RateLimitedError
      simulateRespondError(7, "Rate limited");

      const client = new Client();
      await expect(client.chat.completions.create({ messages: basicMessages })).rejects.toThrow();

      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });

    it("warns on unsupported model name", async () => {
      simulateRespondSuccess("test");
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const client = new Client();
      await client.chat.completions.create({
        messages: basicMessages,
        model: "gpt-4o",
      });

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("gpt-4o"));
      warnSpy.mockRestore();
      client.close();
    });
  });

  describe("close", () => {
    it("disposes the model", () => {
      const client = new Client();
      client.close();
      // SystemLanguageModel.dispose calls FMRelease on model pointer
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-model-pointer");
    });

    it("supports Symbol.dispose", () => {
      const client = new Client();
      expect(typeof client[Symbol.dispose]).toBe("function");
      client[Symbol.dispose]();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-model-pointer");
    });
  });

  describe("error handling — non-streaming", () => {
    it("returns finish_reason length for ExceededContextWindowSizeError", async () => {
      // Status 1 = ExceededContextWindowSizeError
      simulateRespondError(1, "Context window exceeded");

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
      });

      expect(result.choices[0].finish_reason).toBe("length");
      client.close();
    });

    it("returns refusal for RefusalError", async () => {
      // Status 9 = RefusalError
      simulateRespondError(9, "Model refused");

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
      });

      expect(result.choices[0].message.content).toBeNull();
      expect(result.choices[0].message.refusal).toContain("refused");
      client.close();
    });

    it("re-throws RateLimitedError with status 429", async () => {
      simulateRespondError(7, "Rate limited");

      const client = new Client();
      try {
        await client.chat.completions.create({ messages: basicMessages });
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as { status: number }).status).toBe(429);
      }
      client.close();
    });

    it("returns finish_reason content_filter for GuardrailViolationError", async () => {
      simulateRespondError(3, "Guardrail violation");

      const client = new Client();
      const result = await client.chat.completions.create({ messages: basicMessages });
      expect(result.choices[0].finish_reason).toBe("content_filter");
      expect(result.choices[0].message.content).toBeNull();
      client.close();
    });

    it("re-throws unhandled errors directly", async () => {
      // Status 2 = AssetsUnavailableError — not specially handled by compat layer
      simulateRespondError(2, "Assets unavailable");

      const client = new Client();
      await expect(client.chat.completions.create({ messages: basicMessages })).rejects.toThrow(
        "Assets unavailable",
      );
      client.close();
    });
  });

  describe("streaming", () => {
    it("returns a Stream instance", async () => {
      simulateStreamSuccess(["Hello", " world"]);

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      expect(stream).toBeDefined();
      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      expect(chunks.length).toBeGreaterThan(0);
      client.close();
    });

    it("emits first chunk with role and empty content", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks[0].choices[0].delta.role).toBe("assistant");
      expect(chunks[0].choices[0].delta.content).toBe("");
      client.close();
    });

    it("emits final chunk with finish_reason stop", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const last = chunks[chunks.length - 1];
      expect(last.choices[0].finish_reason).toBe("stop");
      client.close();
    });
  });

  describe("tools — non-streaming", () => {
    it("returns tool_calls when model decides to call a tool", async () => {
      simulateStructuredSuccess({
        type: "tool_call",
        tool_call: { name: "get_weather", arguments: { city: "SF" } },
      });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
      });

      expect(result.choices[0].finish_reason).toBe("tool_calls");
      expect(result.choices[0].message.content).toBeNull();
      expect(result.choices[0].message.tool_calls).toHaveLength(1);
      expect(result.choices[0].message.tool_calls![0].function.name).toBe("get_weather");
      expect(result.choices[0].message.tool_calls![0].function.arguments).toBe('{"city":"SF"}');
      expect(result.choices[0].message.tool_calls![0].id).toMatch(/^call_/);
      client.close();
    });

    it("returns empty string content when model text response has no content field", async () => {
      simulateStructuredSuccess({ type: "text" });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
      });

      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.choices[0].message.content).toBe("");
      client.close();
    });

    it("returns text when model responds with text despite tools", async () => {
      simulateStructuredSuccess({ type: "text", content: "I can help with that" });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
      });

      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.choices[0].message.content).toBe("I can help with that");
      expect(result.choices[0].message.tool_calls).toBeUndefined();
      client.close();
    });

    it("injects tool instructions when no system message exists", async () => {
      simulateStructuredSuccess({ type: "text", content: "ok" });

      const client = new Client();
      await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
      });

      // Verify FMTranscriptCreateFromJSONString was called with tool instructions in transcript
      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalled();
      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instructionsEntry = parsed.transcript.entries.find(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instructionsEntry).toBeDefined();
      expect(instructionsEntry.contents[0].text).toContain("get_weather");
      client.close();
    });

    it("appends tool instructions to existing system message", async () => {
      simulateStructuredSuccess({ type: "text", content: "ok" });

      const client = new Client();
      await client.chat.completions.create({
        messages: [
          { role: "system", content: "Be helpful." },
          { role: "user", content: "Hello" },
        ],
        tools: sampleTools,
      });

      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalled();
      const transcriptArg = String(mockFns.FMTranscriptCreateFromJSONString.mock.lastCall?.[0]);
      const parsed = JSON.parse(transcriptArg);
      const instructionsEntry = parsed.transcript.entries.find(
        (e: { role: string }) => e.role === "instructions",
      );
      expect(instructionsEntry.contents[0].text).toContain("Be helpful.");
      expect(instructionsEntry.contents[0].text).toContain("get_weather");
      client.close();
    });

    it("uses plain text when last message is a tool result", async () => {
      simulateRespondSuccess("The weather in SF is sunny.");

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: [
          { role: "user", content: "What's the weather?" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function" as const,
                function: { name: "get_weather", arguments: '{"city":"SF"}' },
              },
            ],
          },
          { role: "tool", tool_call_id: "call_1", content: "Sunny, 72°F" },
        ],
        tools: sampleTools,
      });

      // Should use plain respond (not structured), so finish_reason is "stop"
      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.choices[0].message.content).toBe("The weather in SF is sunny.");
      expect(result.choices[0].message.tool_calls).toBeUndefined();
      client.close();
    });
  });

  describe("json_schema response format — non-streaming", () => {
    it("returns parsed JSON as content string", async () => {
      simulateStructuredSuccess({ name: "John", age: 30 });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      });

      expect(result.choices[0].finish_reason).toBe("stop");
      const parsed = JSON.parse(result.choices[0].message.content!);
      expect(parsed.name).toBe("John");
      expect(parsed.age).toBe(30);
      client.close();
    });

    it("falls back to { type: 'object' } schema when json_schema.schema is omitted", async () => {
      simulateStructuredSuccess({ answer: 42 });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        response_format: {
          type: "json_schema",
          json_schema: { name: "Bare" },
        } as never,
      });

      expect(result.choices[0].finish_reason).toBe("stop");
      expect(result.choices[0].message.content).toBeDefined();
      client.close();
    });

    it("reorders JSON keys to match schema property order", async () => {
      // Model returns keys in different order than schema defines
      simulateStructuredSuccess({ age: 30, name: "John" });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      });

      // Keys should be in schema order: name first, then age
      const content = result.choices[0].message.content!;
      expect(content).toBe('{"name":"John","age":30}');
      client.close();
    });

    it("preserves extra keys not in schema during reordering", async () => {
      simulateStructuredSuccess({ name: "John", extra: "data", age: 30 });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      });

      const parsed = JSON.parse(result.choices[0].message.content!);
      expect(Object.keys(parsed)).toEqual(["name", "age", "extra"]);
      client.close();
    });

    it("passes through invalid JSON unchanged during reordering", async () => {
      // Make decodeAndFreeString return invalid JSON for this test
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
      const result = await client.chat.completions.create({
        messages: basicMessages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Test",
            schema: {
              type: "object",
              properties: { x: { type: "string" } },
            },
          },
        },
      });

      expect(result.choices[0].message.content).toBe("not valid json {{{");
      client.close();
    });

    it("skips missing schema properties when reordering", async () => {
      // Object is missing the "age" property defined in schema
      simulateStructuredSuccess({ name: "John" });

      const client = new Client();
      const result = await client.chat.completions.create({
        messages: basicMessages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "Person",
            schema: {
              type: "object",
              properties: { name: { type: "string" }, age: { type: "integer" } },
            },
          },
        },
      });

      const parsed = JSON.parse(result.choices[0].message.content!);
      expect(Object.keys(parsed)).toEqual(["name"]);
      client.close();
    });
  });

  describe("json_object response format", () => {
    it("appends JSON instruction to prompt", async () => {
      simulateRespondSuccess('{"result": 42}');

      const client = new Client();
      await client.chat.completions.create({
        messages: basicMessages,
        response_format: { type: "json_object" },
      });

      // Check that the prompt passed to FMLanguageModelSessionRespond includes JSON instruction
      const respondArgs = mockFns.FMLanguageModelSessionRespond.mock.calls[0];
      const prompt = respondArgs[1] as string;
      expect(prompt).toContain("Respond with valid JSON only");
      client.close();
    });
  });

  describe("streaming — tools", () => {
    it("buffers tool call and emits as chunks", async () => {
      simulateStructuredSuccess({
        type: "tool_call",
        tool_call: { name: "get_weather", arguments: { city: "NYC" } },
      });

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      // First chunk: role announcement
      expect(chunks[0].choices[0].delta.role).toBe("assistant");
      // Tool call chunk
      const toolChunk = chunks.find((c) => c.choices[0].delta.tool_calls);
      expect(toolChunk).toBeDefined();
      expect(toolChunk!.choices[0].delta.tool_calls![0].function!.name).toBe("get_weather");
      // Final chunk
      const last = chunks[chunks.length - 1];
      expect(last.choices[0].finish_reason).toBe("tool_calls");
      client.close();
    });

    it("buffers text response with missing content and emits empty string", async () => {
      simulateStructuredSuccess({ type: "text" });

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const contentChunk = chunks.find((c) => c.choices[0].delta.content === "");
      expect(contentChunk).toBeDefined();
      const last = chunks[chunks.length - 1];
      expect(last.choices[0].finish_reason).toBe("stop");
      client.close();
    });

    it("buffers text response with tools and emits as chunks", async () => {
      simulateStructuredSuccess({ type: "text", content: "No tool needed" });

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        tools: sampleTools,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const contentChunk = chunks.find((c) => c.choices[0].delta.content === "No tool needed");
      expect(contentChunk).toBeDefined();
      const last = chunks[chunks.length - 1];
      expect(last.choices[0].finish_reason).toBe("stop");
      client.close();
    });
  });

  describe("streaming — error handling", () => {
    it("emits finish_reason length for ExceededContextWindowSizeError", async () => {
      simulateStreamError(1, "Context window exceeded");

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const last = chunks[chunks.length - 1];
      expect(last.choices[0].finish_reason).toBe("length");
      client.close();
    });

    it("emits refusal chunk for RefusalError", async () => {
      simulateStreamError(9, "Model refused");

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      const chunks: ChatCompletionChunk[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      const refusalChunk = chunks.find((c) => c.choices[0].delta.refusal);
      expect(refusalChunk).toBeDefined();
      expect(refusalChunk!.choices[0].delta.refusal).toContain("refused");
      client.close();
    });

    it("throws CompatError with status 429 for RateLimitedError", async () => {
      simulateStreamError(7, "Rate limited");

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      try {
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as { status: number }).status).toBe(429);
      }
      client.close();
    });

    it("yields finish_reason content_filter for GuardrailViolationError during streaming", async () => {
      simulateStreamError(3, "Guardrail violation");

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const last = chunks[chunks.length - 1];
      expect(last.choices[0].finish_reason).toBe("content_filter");
      client.close();
    });

    it("re-throws unhandled errors directly during streaming", async () => {
      simulateStreamError(2, "Assets unavailable");

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      await expect(async () => {
        for await (const chunk of stream) {
          expect(chunk).toBeDefined();
        }
      }).rejects.toThrow("Assets unavailable");
      client.close();
    });

    it("stream.close() disposes the session", async () => {
      simulateStreamSuccess(["Hi"]);

      const client = new Client();
      const stream = await client.chat.completions.create({
        messages: basicMessages,
        stream: true,
      });

      mockFns.FMRelease.mockClear();
      stream.close();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      client.close();
    });
  });
});
