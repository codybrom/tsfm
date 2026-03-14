import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const { capturedSessionRegistryCallback } = vi.hoisted(() => {
  let registryCb: ((pointer: unknown) => void) | null = null;
  globalThis.FinalizationRegistry = class MockFinalizationRegistry {
    constructor(callback: (pointer: unknown) => void) {
      registryCb = callback;
    }
    register() {}
    unregister() {}
  } as unknown as typeof FinalizationRegistry;
  return { capturedSessionRegistryCallback: () => registryCb };
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

vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeString: vi.fn((pointer: unknown) => {
    if (!pointer) return null;
    // In tests, callbacks receive plain strings as mock pointers —
    // pass them through so existing assertions work unchanged.
    if (typeof pointer === "string") return pointer;
    return null;
  }),
  decodeAndFreeString: vi.fn((pointer: unknown) => {
    if (!pointer) return null;
    return '{"key":"value"}';
  }),
  unregisterCallback: vi.fn(),
  ResponseCallbackProto: "ResponseCallbackProto",
  StructuredResponseCallbackProto: "StructuredResponseCallbackProto",
}));

vi.mock("../../src/tool.js", () => ({
  Tool: class MockTool {
    _nativeTool = "mock-tool-pointer";
    _register() {}
  },
}));

import { LanguageModelSession } from "../../src/session.js";

beforeEach(() => {
  vi.clearAllMocks();
  lastRegisteredCallback = null;
});

describe("LanguageModelSession", () => {
  it("creates session with default options", () => {
    const session = new LanguageModelSession();
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).toHaveBeenCalledWith(
      null,
      null,
      null,
      0,
    );
    expect(session._nativeSession).toBe("mock-session-pointer");
  });

  it("creates session with instructions", () => {
    new LanguageModelSession({ instructions: "Be helpful" });
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).toHaveBeenCalledWith(
      null,
      "Be helpful",
      null,
      0,
    );
  });

  it("throws when C returns null pointer", () => {
    mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel.mockReturnValueOnce(null);
    expect(() => new LanguageModelSession()).toThrow("Failed to create LanguageModelSession");
  });

  describe("isResponding", () => {
    it("returns false when not responding", () => {
      const session = new LanguageModelSession();
      expect(session.isResponding).toBe(false);
    });

    it("returns false when pointer is null (disposed)", () => {
      const session = new LanguageModelSession();
      session.dispose();
      expect(session.isResponding).toBe(false);
    });
  });

  describe("respond", () => {
    it("resolves with response text on success", async () => {
      mockFns.FMLanguageModelSessionRespond.mockImplementation(() => {
        setTimeout(() => {
          lastRegisteredCallback?.(0, "Hello world", 11, null);
        }, 0);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const result = await session.respond("Hi");
      expect(result).toBe("Hello world");
    });

    it("resolves with empty string when content is null", async () => {
      mockFns.FMLanguageModelSessionRespond.mockImplementation(() => {
        setTimeout(() => {
          lastRegisteredCallback?.(0, null, 0, null);
        }, 0);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const result = await session.respond("Hi");
      expect(result).toBe("");
    });

    it("keepalive interval fires while waiting for callback", async () => {
      vi.useFakeTimers();
      mockFns.FMLanguageModelSessionRespond.mockImplementation(() => {
        // Schedule callback after 15s so the 10s keepalive fires first
        setTimeout(() => {
          lastRegisteredCallback?.(0, "delayed", 7, null);
        }, 15000);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const promise = session.respond("Hi");
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;
      expect(result).toBe("delayed");
      vi.useRealTimers();
    });

    it("rejects with error on non-zero status", async () => {
      mockFns.FMLanguageModelSessionRespond.mockImplementation(() => {
        setTimeout(() => {
          lastRegisteredCallback?.(7, "Rate limited", 12, null);
        }, 0);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      await expect(session.respond("Hi")).rejects.toThrow("Rate limited");
    });
  });

  describe("cancel", () => {
    it("calls FMTaskCancel and FMLanguageModelSessionReset", () => {
      const session = new LanguageModelSession();
      (session as unknown as { _activeTask: unknown })._activeTask = "mock-task";
      session.cancel();
      expect(mockFns.FMTaskCancel).toHaveBeenCalledWith("mock-task");
      expect(mockFns.FMLanguageModelSessionReset).toHaveBeenCalledWith("mock-session-pointer");
    });
  });

  describe("dispose", () => {
    it("releases the session pointer", () => {
      const session = new LanguageModelSession();
      session.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
      expect(session._nativeSession).toBeNull();
    });

    it("is safe to call twice", () => {
      const session = new LanguageModelSession();
      session.dispose();
      session.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe("process exit cleanup", () => {
    it("disposes live sessions on process exit", () => {
      // Dispose any sessions left over from prior tests to isolate this test
      process.emit("exit", 0);

      const s1 = new LanguageModelSession();
      const s2 = new LanguageModelSession();
      expect(s1._nativeSession).not.toBeNull();
      expect(s2._nativeSession).not.toBeNull();

      // Simulate process exit — triggers the cleanup handler
      process.emit("exit", 0);

      expect(s1._nativeSession).toBeNull();
      expect(s2._nativeSession).toBeNull();
    });

    it("does not fail if sessions are already disposed before exit", () => {
      process.emit("exit", 0); // clear any leftovers

      const session = new LanguageModelSession();
      session.dispose();
      vi.clearAllMocks();

      // Should not throw or double-release
      process.emit("exit", 0);
      expect(mockFns.FMRelease).not.toHaveBeenCalled();
    });
  });

  describe("signal handlers", () => {
    it("cleans up sessions and re-raises on SIGINT", () => {
      process.emit("exit", 0); // clear leftovers

      const session = new LanguageModelSession();
      expect(session._nativeSession).not.toBeNull();

      // Capture the SIGINT listener that _installExitHandler registered
      const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

      // Emit SIGINT to trigger the handler
      process.emit("SIGINT", "SIGINT");

      expect(session._nativeSession).toBeNull();
      expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT");
      killSpy.mockRestore();
    });
  });

  describe("Symbol.dispose", () => {
    it("delegates to dispose()", () => {
      const session = new LanguageModelSession();
      session[Symbol.dispose]();
      expect(session._nativeSession).toBeNull();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
    });
  });

  describe("cancel", () => {
    it("does nothing when no active task and pointer is null", () => {
      const session = new LanguageModelSession();
      session.dispose(); // sets _nativeSession to null
      session.cancel();
      expect(mockFns.FMTaskCancel).not.toHaveBeenCalled();
      expect(mockFns.FMLanguageModelSessionReset).not.toHaveBeenCalled();
    });

    it("resets session but does not cancel when no active task", () => {
      const session = new LanguageModelSession();
      session.cancel();
      expect(mockFns.FMTaskCancel).not.toHaveBeenCalled();
      expect(mockFns.FMLanguageModelSessionReset).toHaveBeenCalledWith("mock-session-pointer");
    });
  });

  describe("respondWithSchema", () => {
    it("keepalive interval fires while waiting for structured callback", async () => {
      vi.useFakeTimers();
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(() => {
        setTimeout(() => {
          lastRegisteredCallback?.(0, "mock-content-ref", null);
        }, 15000);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      const promise = session.respondWithSchema("Describe", mockSchema as never);
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;
      expect(result._nativeContent).toBe("mock-content-ref");
      vi.useRealTimers();
    });

    it("resolves with GeneratedContent on success", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(() => {
        setTimeout(() => {
          lastRegisteredCallback?.(0, "mock-content-ref", null);
        }, 0);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      const result = await session.respondWithSchema("Describe", mockSchema as never);
      expect(result).toBeDefined();
      expect(result._nativeContent).toBe("mock-content-ref");
    });

    it("rejects with error on non-zero status", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(() => {
        setTimeout(() => {
          lastRegisteredCallback?.(3, "mock-content-ref", null);
        }, 0);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      await expect(session.respondWithSchema("Describe", mockSchema as never)).rejects.toThrow(
        "Guardrail violation",
      );
      expect(mockFns.FMGeneratedContentGetJSONString).toHaveBeenCalledWith("mock-content-ref");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-content-ref");
    });

    it("passes generation options to the C function", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation((..._args: unknown[]) => {
        setTimeout(() => {
          lastRegisteredCallback?.(0, "mock-content-ref", null);
        }, 0);
        return "mock-task-pointer";
      });

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      await session.respondWithSchema("Describe", mockSchema as never, {
        options: { temperature: 0.5 },
      });

      expect(mockFns.FMLanguageModelSessionRespondWithSchema).toHaveBeenCalledWith(
        "mock-session-pointer",
        "Describe",
        "mock-schema-pointer",
        JSON.stringify({ temperature: 0.5 }),
        null,
        "mock-cb-pointer",
      );
    });
  });

  describe("respondWithJsonSchema", () => {
    it("resolves with GeneratedContent on success", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      const jsonSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };
      const result = await session.respondWithJsonSchema("Extract info", jsonSchema);
      expect(result).toBeDefined();
      expect(result._nativeContent).toBe("mock-content-ref");
    });

    it("applies afmSchemaFormat transformations", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      const jsonSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };
      await session.respondWithJsonSchema("Extract", jsonSchema);

      const calledSchema = JSON.parse(
        mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mock.calls[0][2] as string,
      );
      expect(calledSchema.title).toBe("Schema");
      expect(calledSchema.additionalProperties).toBe(false);
      expect(calledSchema["x-order"]).toEqual(["name", "age"]);
    });

    it("handles schema without properties key", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      const jsonSchema = { type: "object" }; // no properties key
      await session.respondWithJsonSchema("Extract", jsonSchema);

      const calledSchema = JSON.parse(
        mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mock.calls[0][2] as string,
      );
      expect(calledSchema["x-order"]).toEqual([]);
      expect(calledSchema.additionalProperties).toBe(false);
    });

    it("preserves existing x-order if provided", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      const jsonSchema = {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
        "x-order": ["age", "name"],
      };
      await session.respondWithJsonSchema("Extract", jsonSchema);

      const calledSchema = JSON.parse(
        mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mock.calls[0][2] as string,
      );
      expect(calledSchema["x-order"]).toEqual(["age", "name"]);
    });

    it("rejects with error on non-zero status", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(7, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      await expect(
        session.respondWithJsonSchema("Extract", { type: "object", properties: {} }),
      ).rejects.toThrow("Rate limited");
    });

    it("rejects with undefined message when content JSON is null", async () => {
      mockFns.FMGeneratedContentGetJSONString.mockReturnValueOnce(null);
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(3, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      await expect(
        session.respondWithJsonSchema("Extract", { type: "object", properties: {} }),
      ).rejects.toThrow();
    });

    it("passes generation options", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        (..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      await session.respondWithJsonSchema(
        "Extract",
        { type: "object", properties: {} },
        { options: { maximumResponseTokens: 100 } },
      );

      expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).toHaveBeenCalledWith(
        "mock-session-pointer",
        "Extract",
        expect.any(String),
        JSON.stringify({ maximum_response_tokens: 100 }),
        null,
        "mock-cb-pointer",
      );
    });
  });

  describe("streamResponse", () => {
    it("keepalive interval fires while waiting for stream chunks", async () => {
      vi.useFakeTimers();
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "chunk", 5, null);
            setTimeout(() => {
              lastRegisteredCallback?.(0, null, 0, null);
            }, 5000);
          }, 15000);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      const gen = session.streamResponse("Hi");
      const iterPromise = (async () => {
        for await (const chunk of gen) {
          chunks.push(chunk);
        }
      })();
      await vi.advanceTimersByTimeAsync(20000);
      await iterPromise;
      expect(chunks).toEqual(["chunk"]);
      vi.useRealTimers();
    });

    it("drains pre-queued items without awaiting", async () => {
      // Push items synchronously so the queue is non-empty before the generator awaits
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          lastRegisteredCallback?.(0, "sync chunk", 10, null);
          lastRegisteredCallback?.(0, null, 0, null);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["sync chunk"]);
    });

    it("skips empty deltas from duplicate cumulative content", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello", 5, null);
            setTimeout(() => {
              // Duplicate same cumulative content — delta is empty
              lastRegisteredCallback?.(0, "Hello", 5, null);
              setTimeout(() => {
                lastRegisteredCallback?.(0, "Hello world", 11, null);
                setTimeout(() => {
                  lastRegisteredCallback?.(0, null, 0, null);
                }, 0);
              }, 0);
            }, 0);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      // The duplicate "Hello" should not produce an empty delta
      expect(chunks).toEqual(["Hello", " world"]);
    });

    it("yields delta strings from cumulative snapshots", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello", 5, null);
            setTimeout(() => {
              lastRegisteredCallback?.(0, "Hello world", 11, null);
              setTimeout(() => {
                lastRegisteredCallback?.(0, null, 0, null);
              }, 0);
            }, 0);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["Hello", " world"]);
    });

    it("throws on error status during streaming", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "partial", 7, null);
            setTimeout(() => {
              lastRegisteredCallback?.(3, "Guardrail violation", 19, null);
            }, 0);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      try {
        for await (const chunk of session.streamResponse("Hi")) {
          chunks.push(chunk);
        }
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Guardrail violation");
      }
      expect(chunks).toEqual(["partial"]);
    });

    it("releases stream ref after completion", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "done", 4, null);
            setTimeout(() => {
              lastRegisteredCallback?.(0, null, 0, null);
            }, 0);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-stream-pointer");
    });

    it("passes options to FMLanguageModelSessionStreamResponse", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, null, 0, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();

      for await (const _chunk of session.streamResponse("Hi", {
        options: { temperature: 0.8 },
      })) {
        // drain
      }
      expect(mockFns.FMLanguageModelSessionStreamResponse).toHaveBeenCalledWith(
        "mock-session-pointer",
        "Hi",
        JSON.stringify({ temperature: 0.8 }),
      );
    });

    it("unregisters callback when consumer breaks early (stream not done)", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          // Send a single chunk, then stop — never send the null end-of-stream signal
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello", 5, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
        break; // consumer breaks early — streamDone is still false
      }
      expect(chunks).toEqual(["Hello"]);
      // The finally block should call unregisterCallback because streamDone is false
      const bindings = await import("../../src/bindings.js");
      expect(bindings.unregisterCallback).toHaveBeenCalledWith("mock-cb-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-stream-pointer");
    });

    it("handles empty stream (immediate null content)", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, null, 0, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    });
  });

  describe("fromTranscript", () => {
    it("creates a session from a transcript", () => {
      const mockTranscript = {
        _nativeSession: "mock-transcript-session-pointer",
        _updateNativeSession: vi.fn(),
      };

      const session = LanguageModelSession.fromTranscript(mockTranscript as never);
      expect(mockFns.FMLanguageModelSessionCreateFromTranscript).toHaveBeenCalledWith(
        "mock-transcript-session-pointer",
        null,
        null,
        0,
      );
      expect(session._nativeSession).toBe("mock-session-pointer");
      expect(mockTranscript._updateNativeSession).toHaveBeenCalledWith("mock-session-pointer");
    });

    it("throws when C returns null pointer", () => {
      mockFns.FMLanguageModelSessionCreateFromTranscript.mockReturnValueOnce(null);
      const mockTranscript = {
        _nativeSession: "mock-transcript-session-pointer",
        _updateNativeSession: vi.fn(),
      };

      expect(() => LanguageModelSession.fromTranscript(mockTranscript as never)).toThrow(
        "Failed to create session from transcript",
      );
    });

    it("passes tools when provided", () => {
      const mockTranscript = {
        _nativeSession: "mock-transcript-session-pointer",
        _updateNativeSession: vi.fn(),
      };
      const mockTool = {
        _nativeTool: "mock-tool-pointer",
        _register: vi.fn(),
      };

      LanguageModelSession.fromTranscript(mockTranscript as never, {
        tools: [mockTool as never],
      });

      expect(mockTool._register).toHaveBeenCalled();
    });
  });

  describe("constructor with tools", () => {
    it("registers tools and passes tool pointers", () => {
      const mockTool = {
        _nativeTool: "mock-tool-pointer",
        _register: vi.fn(),
      };

      new LanguageModelSession({ tools: [mockTool as never] });
      expect(mockTool._register).toHaveBeenCalled();
    });
  });

  describe("_enqueue serialization", () => {
    it("serializes concurrent respond calls", async () => {
      const callOrder: number[] = [];

      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        (_pointer: unknown, prompt: unknown, _opts: unknown, _ui: unknown, _cbPointer: unknown) => {
          const idx = prompt === "first" ? 1 : 2;
          callOrder.push(idx);
          setTimeout(() => {
            lastRegisteredCallback?.(0, `Response ${idx}`, 10, null);
          }, 0);
          return "mock-task-pointer";
        },
      );

      const session = new LanguageModelSession();
      const [r1, r2] = await Promise.all([session.respond("first"), session.respond("second")]);

      expect(r1).toBe("Response 1");
      expect(r2).toBe("Response 2");
      expect(callOrder).toEqual([1, 2]);
    });
  });

  describe("FinalizationRegistry cleanup", () => {
    it("releases pointer when GC callback fires", () => {
      const cleanup = capturedSessionRegistryCallback();
      expect(cleanup).toBeTypeOf("function");
      cleanup!("leaked-session-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("leaked-session-pointer");
    });

    it("swallows errors in GC callback", () => {
      mockFns.FMRelease.mockImplementationOnce(() => {
        throw new Error("already released");
      });
      const cleanup = capturedSessionRegistryCallback();
      expect(() => cleanup!("bad-pointer")).not.toThrow();
    });
  });

  describe("transcript getter guard", () => {
    it("returns transcript on initialized session", () => {
      const session = new LanguageModelSession();
      const transcript = session.transcript;
      expect(transcript).toBeDefined();
    });

    it("throws when transcript is accessed on uninitialized session", () => {
      const session = new LanguageModelSession();
      (session as unknown as { _transcript: null })._transcript = null;
      expect(() => session.transcript).toThrow("Session not initialized");
    });
  });

  describe("streaming early break reset", () => {
    it("calls FMLanguageModelSessionReset on active session", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello", 5, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      for await (const _chunk of session.streamResponse("Hi")) {
        break;
      }
      expect(mockFns.FMLanguageModelSessionReset).toHaveBeenCalledWith("mock-session-pointer");
    });

    it("cancel() unblocks a waiting stream consumer", async () => {
      // The callback never fires — the stream blocks until cancel() is called.
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(() => {});

      const session = new LanguageModelSession();
      const chunks: string[] = [];

      // Schedule cancel() after the stream has started waiting.
      setTimeout(() => session.cancel(), 10);

      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    });

    it("skips coerced null string chunks from koffi", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            // Simulate koffi coercing a null C string to the JS string "null"
            lastRegisteredCallback?.(0, "null", 4, null);
            lastRegisteredCallback?.(0, "real content", 12, null);
            lastRegisteredCallback?.(0, null, 0, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual(["real content"]);
    });

    it("treats null pointer as end-of-stream signal", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, null, 0, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
    });

    it("skips reset when session is already disposed", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello", 5, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      for await (const _chunk of session.streamResponse("Hi")) {
        session.dispose();
        break;
      }
      expect(mockFns.FMLanguageModelSessionReset).not.toHaveBeenCalled();
    });
  });

  describe("prewarm", () => {
    it("calls C API with prompt prefix", () => {
      const session = new LanguageModelSession();
      session.prewarm("Hello");
      expect(mockFns.FMLanguageModelSessionPrewarm).toHaveBeenCalledWith(
        "mock-session-pointer",
        "Hello",
      );
    });

    it("passes null when no prompt prefix is provided", () => {
      const session = new LanguageModelSession();
      session.prewarm();
      expect(mockFns.FMLanguageModelSessionPrewarm).toHaveBeenCalledWith(
        "mock-session-pointer",
        null,
      );
    });

    it("is a no-op on a disposed session", () => {
      const session = new LanguageModelSession();
      session.dispose();
      session.prewarm("Hello");
      expect(mockFns.FMLanguageModelSessionPrewarm).not.toHaveBeenCalled();
    });
  });
});
