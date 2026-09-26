import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockFunctions } from "./helpers/mock-bindings.js";

// The addon returns promises and takes JS callbacks. These wrappers let a test
// answer a request the way the native side does, by firing
// `lastRegisteredCallback`: (status, text) for text requests and streams, or
// (status, content) for structured ones. A test's own implementation runs
// after the callback is set, as koffi's registration used to.
let lastRegisteredCallback: ((...args: unknown[]) => void) | null = null;

type Impl = (...args: unknown[]) => unknown;

/** A text request: [promise, request], settled through lastRegisteredCallback. */
function textRequest(impl?: Impl) {
  return (...args: unknown[]) => {
    let resolve!: (result: unknown) => void;
    const result = new Promise((r) => (resolve = r));
    lastRegisteredCallback = (status, text) => resolve({ status, text: text ?? null });
    impl?.(...args);
    return [result, "mock-task-pointer"] as never;
  };
}

/** A structured request: [promise, request], settled through lastRegisteredCallback. */
function structuredRequest(impl?: Impl) {
  return (...args: unknown[]) => {
    let resolve!: (result: unknown) => void;
    const result = new Promise((r) => (resolve = r));
    lastRegisteredCallback = (status, content, message) =>
      resolve(
        status === 0
          ? { status, content, message: null }
          : { status, content: null, message: (message as string | null) ?? null },
      );
    impl?.(...args);
    return [result, "mock-task-pointer"] as never;
  };
}

/**
 * A stream: onChunk becomes lastRegisteredCallback, and
 * FMLanguageModelSessionResponseStreamIterate (a test hook) starts it, as the
 * native side did. An implementation returning null means it couldn't start.
 */
function streamRequest(impl?: Impl) {
  return (...args: unknown[]) => {
    const onChunk = args[3] as (status: number, text: string | null) => void;
    lastRegisteredCallback = (status, text) =>
      onChunk(status as number, (text as string | null) ?? null);
    if (impl?.(...args) === null) return null;
    mockFns.FMLanguageModelSessionResponseStreamIterate("mock-stream-pointer", null, onChunk);
    return "mock-stream-pointer";
  };
}

const mockFns = {
  ...createMockFunctions(),
  /** Test hook: runs when a stream starts; drive it with lastRegisteredCallback. */
  FMLanguageModelSessionResponseStreamIterate: vi.fn((..._args: unknown[]) => {}),
};
mockFns.FMLanguageModelSessionRespond.mockImplementation(textRequest());
mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(structuredRequest());
mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(structuredRequest());
mockFns.FMLanguageModelSessionStreamResponse.mockImplementation(streamRequest());

vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
}));

vi.mock("../../src/tool.js", () => ({
  Tool: class MockTool {
    _nativeTool = "mock-tool-pointer";
    _bindToSession() {
      return this;
    }
    dispose() {}
  },
}));

import { LanguageModelSession } from "../../src/session.js";
import { Transcript } from "../../src/transcript.js";
import { PrivateCloudComputeLanguageModel } from "../../src/pcc.js";
import {
  FailRequestError,
  FoundationModelsError,
  GenerationError,
  GenerationErrorCode,
  InvalidGenerationSchemaError,
  PromptAttachmentError,
  RateLimitedError,
  RequestFailedByToolError,
  UnsupportedCapabilityError,
  UnsupportedGuideError,
} from "../../src/errors.js";
import { GenerationSchema, type JsonSchema } from "../../src/schema.js";
import { recordToolFailure, type ToolCallBudget } from "../../src/tool-budget.js";

beforeEach(() => {
  vi.clearAllMocks();
  lastRegisteredCallback = null;
  mockFns.FMRequestCancel.mockImplementation((handle) => {
    if (handle === "mock-stream-pointer") lastRegisteredCallback?.(23, "Stream cancelled");
  });
});

// A test that fails before restoring real timers would otherwise leave fake
// timers installed and make every later setTimeout-based mock time out.
afterEach(() => {
  vi.useRealTimers();
});

describe("LanguageModelSession", () => {
  it("creates session with default options", () => {
    const session = new LanguageModelSession();
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).toHaveBeenCalledWith(
      null,
      null,
      [],
    );
    expect(session._nativeSession).toBe("mock-session-pointer");
  });

  it("creates session with instructions", () => {
    new LanguageModelSession({ instructions: "Be helpful" });
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).toHaveBeenCalledWith(
      null,
      "Be helpful",
      [],
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

  describe('streaming a literal "null" response', () => {
    it("yields it instead of discarding it as an artifact", async () => {
      // Fire the snapshots once the stream is actually started, as the native
      // side does, rather than at an arbitrary tick after streamResponse().
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementationOnce(() => {
        queueMicrotask(() => {
          lastRegisteredCallback?.(0, "null", 4, null);
          queueMicrotask(() => lastRegisteredCallback?.(0, null, 0, null));
        });
      });
      const session = new LanguageModelSession();
      const chunks: string[] = [];
      const iterator = session.streamResponse("Reply with exactly: null");
      for await (const c of iterator) chunks.push(c);
      expect(chunks.join("")).toBe("null");
    });

    it("still yields text that merely starts with null", async () => {
      const session = new LanguageModelSession();
      const chunks: string[] = [];
      const iterator = session.streamResponse("x");
      queueMicrotask(() => {
        lastRegisteredCallback?.(0, "null", 4, null);
        queueMicrotask(() => {
          lastRegisteredCallback?.(0, "null and void", 13, null);
          queueMicrotask(() => lastRegisteredCallback?.(0, null, 0, null));
        });
      });
      for await (const c of iterator) chunks.push(c);
      expect(chunks.join("")).toBe("null and void");
    });
  });

  describe("prompt attachments", () => {
    // Attachments are checked to exist before any native call, so use a real file.
    let dir: string;
    let image: string;
    beforeEach(() => {
      dir = mkdtempSync(path.join(tmpdir(), "tsfm-session-"));
      image = path.join(dir, "a.jpg");
      writeFileSync(image, "jpg");
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("throws not-found for a missing file before touching native code", async () => {
      const session = new LanguageModelSession();
      const missing = path.join(dir, "missing.jpg");
      const err = await session.respond({ content: [{ path: missing }] }).catch((e) => e);
      expect(err).toBeInstanceOf(PromptAttachmentError);
      expect(err.reason).toBe("not-found");
      expect(mockFns.FMComposedPromptInitialize).not.toHaveBeenCalled();
      expect(mockFns.FMLanguageModelSessionRespond).not.toHaveBeenCalled();
    });

    it("composes { content } parts in order, with the text after the image", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond({
        content: [{ path: image, label: "photo" }, "Describe it."],
      });
      queueMicrotask(() => lastRegisteredCallback?.(0, "ok", 2, null));
      await promise;
      const attachmentOrder = mockFns.FMComposedPromptAddAttachment.mock.invocationCallOrder[0];
      const textOrder = mockFns.FMComposedPromptAddText.mock.invocationCallOrder[0];
      expect(attachmentOrder).toBeLessThan(textOrder);
      expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith(
        "mock-composed-prompt",
        "Describe it.",
      );
    });

    it("adds an attachment with its label", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond({
        text: "What is this?",
        attachments: [{ path: image, label: "diagram" }],
      });
      queueMicrotask(() => lastRegisteredCallback?.(0, "ok", 2, null));
      await promise;

      expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith(
        "mock-composed-prompt",
        "What is this?",
      );
      expect(mockFns.FMComposedPromptAddAttachment).toHaveBeenCalledWith(
        "mock-composed-prompt",
        image,
        "diagram",
      );
    });

    it("passes null for an attachment with no label", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond({ text: "hi", attachments: [{ path: image }] });
      queueMicrotask(() => lastRegisteredCallback?.(0, "ok", 2, null));
      await promise;
      expect(mockFns.FMComposedPromptAddAttachment).toHaveBeenCalledWith(
        "mock-composed-prompt",
        image,
        null,
      );
    });

    it("reports why the bridge refused the attachment", async () => {
      // 2 = FMComposedPromptAddImageErrorUnsupportedSDK, which is what a
      // dylib built without the macOS 27 SDK always returns.
      mockFns.FMComposedPromptAddAttachment.mockReturnValueOnce(2);
      const session = new LanguageModelSession();
      await expect(session.respond({ text: "hi", attachments: [{ path: image }] })).rejects.toThrow(
        /macOS 27/i,
      );
    });

    it("releases the composed prompt when an attachment is refused", async () => {
      mockFns.FMComposedPromptAddAttachment.mockReturnValueOnce(1);
      const session = new LanguageModelSession();
      await expect(
        session.respond({ text: "hi", attachments: [{ path: image }] }),
      ).rejects.toThrow();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
    });
  });

  describe("composed prompt lifetime", () => {
    it("passes the prompt text through a composed prompt, not as a string", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond("Hello");
      queueMicrotask(() => lastRegisteredCallback?.(0, "hi", 2, null));
      await promise;

      expect(mockFns.FMComposedPromptInitialize).toHaveBeenCalled();
      expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith("mock-composed-prompt", "Hello");
      expect(mockFns.FMLanguageModelSessionRespond.mock.calls[0][1]).toBe("mock-composed-prompt");
    });

    it("releases the composed prompt after the response resolves", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond("Hello");
      queueMicrotask(() => lastRegisteredCallback?.(0, "hi", 2, null));
      await promise;
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
    });

    it("releases the composed prompt when the response fails", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond("Hello");
      queueMicrotask(() => lastRegisteredCallback?.(7, "boom", 4, null));
      await expect(promise).rejects.toThrow();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
    });

    it("releases the composed prompt when the stream ends", async () => {
      const session = new LanguageModelSession();
      const chunks: string[] = [];
      const iterator = session.streamResponse("Hello");
      queueMicrotask(() => {
        lastRegisteredCallback?.(0, "chunk", 5, null);
        queueMicrotask(() => lastRegisteredCallback?.(0, null, 0, null));
      });
      for await (const c of iterator) chunks.push(c);
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
    });
  });

  describe("respond", () => {
    it.each([
      ["respond", "FMLanguageModelSessionRespond"],
      ["respondWithSchema", "FMLanguageModelSessionRespondWithSchema"],
      ["respondWithJsonSchema", "FMLanguageModelSessionRespondWithSchemaFromJSON"],
    ] as const)(
      "%s releases the composed prompt when the native call throws while starting",
      async (method, native) => {
        mockFns[native].mockImplementationOnce(() => {
          throw new TypeError("bad argument");
        });
        const session = new LanguageModelSession();
        const run =
          method === "respond"
            ? session.respond("Hi")
            : method === "respondWithSchema"
              ? session.respondWithSchema("Hi", new GenerationSchema("S", "s"))
              : session.respondWithJsonSchema("Hi", { type: "object", properties: {} });
        await expect(run).rejects.toThrow("bad argument");
        expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
      },
    );

    it("releases the request handle once the response settles", async () => {
      mockFns.FMLanguageModelSessionRespond.mockReturnValueOnce([
        Promise.resolve({ status: 0, text: "hi" }),
        "settled-request",
      ] as never);
      const session = new LanguageModelSession();
      await session.respond("Hi");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("settled-request");
    });

    it("resolves with response text on success", async () => {
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello world", 11, null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const result = await session.respond("Hi");
      expect(result.content).toBe("Hello world");
    });

    it("resolves with empty string when content is null", async () => {
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, null, 0, null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const result = await session.respond("Hi");
      expect(result.content).toBe("");
    });

    it("keepalive interval fires while waiting for callback", async () => {
      vi.useFakeTimers();
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest(() => {
          // Schedule callback after 15s so the 10s keepalive fires first
          setTimeout(() => {
            lastRegisteredCallback?.(0, "delayed", 7, null);
          }, 15000);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const promise = session.respond("Hi");
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;
      expect(result.content).toBe("delayed");
      vi.useRealTimers();
    });

    it("rejects with error on non-zero status", async () => {
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(7, "Rate limited", 12, null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      await expect(session.respond("Hi")).rejects.toThrow("Rate limited");
    });
  });

  describe("cancel", () => {
    it("calls FMRequestCancel and FMLanguageModelSessionReset", () => {
      const session = new LanguageModelSession();
      (session as unknown as { _activeTask: unknown })._activeTask = "mock-task";
      session.cancel();
      expect(mockFns.FMRequestCancel).toHaveBeenCalledWith("mock-task");
      expect(mockFns.FMRelease).not.toHaveBeenCalledWith("mock-task");
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
    it("doesn't install any: a library must not change the host's signal handling", () => {
      const before = {
        SIGINT: process.listenerCount("SIGINT"),
        SIGTERM: process.listenerCount("SIGTERM"),
      };
      new LanguageModelSession();
      expect(process.listenerCount("SIGINT")).toBe(before.SIGINT);
      expect(process.listenerCount("SIGTERM")).toBe(before.SIGTERM);
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
      expect(mockFns.FMRequestCancel).not.toHaveBeenCalled();
      expect(mockFns.FMLanguageModelSessionReset).not.toHaveBeenCalled();
    });

    it("resets session but does not cancel when no active task", () => {
      const session = new LanguageModelSession();
      session.cancel();
      expect(mockFns.FMRequestCancel).not.toHaveBeenCalled();
      expect(mockFns.FMLanguageModelSessionReset).toHaveBeenCalledWith("mock-session-pointer");
    });
  });

  describe("respondWithSchema", () => {
    it("keepalive interval fires while waiting for structured callback", async () => {
      vi.useFakeTimers();
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(
        structuredRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 15000);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      const promise = session.respondWithSchema("Describe", mockSchema as never);
      await vi.advanceTimersByTimeAsync(15000);
      const result = await promise;
      expect(result.content._nativeContent).toBe("mock-content-ref");
      vi.useRealTimers();
    });

    it("resolves with GeneratedContent on success", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(
        structuredRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      const result = await session.respondWithSchema("Describe", mockSchema as never);
      expect(result).toBeDefined();
      expect(result.content._nativeContent).toBe("mock-content-ref");
    });

    it("rejects with error on non-zero status", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(
        structuredRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(3, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      await expect(session.respondWithSchema("Describe", mockSchema as never)).rejects.toThrow(
        "Guardrail violation",
      );
      // The addon reads the error message from the content and releases it.
    });

    it("decodes the JSON-quoted message of a failed structured request", async () => {
      // The addon reads the bridge's error content as JSON, so a message the
      // bridge built from a string arrives quoted and escaped.
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(
        structuredRequest(() => {
          setTimeout(() => {
            lastRegisteredCallback?.(
              GenerationErrorCode.RATE_LIMITED,
              null,
              JSON.stringify('[tsfm-reset-date:2026-09-22T18:30:00Z] Too "many" requests'),
            );
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      const err = await session
        .respondWithSchema("Describe", mockSchema as never)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(RateLimitedError);
      expect((err as RateLimitedError).resetDate).toEqual(new Date("2026-09-22T18:30:00Z"));
      expect((err as Error).message).toContain('Too "many" requests');
      expect((err as Error).message).not.toContain("tsfm-reset-date");
    });

    it("passes generation options to the C function", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      await session.respondWithSchema("Describe", mockSchema as never, {
        options: { temperature: 0.5 },
      });

      expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith(
        "mock-composed-prompt",
        "Describe",
      );
      expect(mockFns.FMLanguageModelSessionRespondWithSchema).toHaveBeenCalledWith(
        "mock-session-pointer",
        "mock-composed-prompt",
        "mock-schema-pointer",
        JSON.stringify({ temperature: 0.5 }),
      );
    });
  });

  describe("respondWithJsonSchema", () => {
    it("rejects a schema nested too deeply before calling native code", async () => {
      let schema: JsonSchema = { type: "string" };
      for (let i = 0; i < 100; i++) schema = { type: "object", properties: { child: schema } };
      const session = new LanguageModelSession();
      await expect(session.respondWithJsonSchema("Extract", schema)).rejects.toBeInstanceOf(
        InvalidGenerationSchemaError,
      );
      expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).not.toHaveBeenCalled();
    });

    it("resolves with GeneratedContent on success", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
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
      expect(result.content._nativeContent).toBe("mock-content-ref");
    });

    it("applies afmSchemaFormat transformations", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
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
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
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
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
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
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(7, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      await expect(
        session.respondWithJsonSchema("Extract", { type: "object", properties: {} }),
      ).rejects.toThrow("Rate limited");
    });

    it("rejects with undefined message when content JSON is null", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(3, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      await expect(
        session.respondWithJsonSchema("Extract", { type: "object", properties: {} }),
      ).rejects.toThrow();
    });

    it("passes generation options", async () => {
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(
        structuredRequest((..._args: unknown[]) => {
          setTimeout(() => {
            lastRegisteredCallback?.(0, "mock-content-ref", null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      await session.respondWithJsonSchema(
        "Extract",
        { type: "object", properties: {} },
        { options: { maximumResponseTokens: 100 } },
      );

      expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith(
        "mock-composed-prompt",
        "Extract",
      );
      expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).toHaveBeenCalledWith(
        "mock-session-pointer",
        "mock-composed-prompt",
        expect.any(String),
        JSON.stringify({ maximum_response_tokens: 100 }),
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
      expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith("mock-composed-prompt", "Hi");
      expect(mockFns.FMLanguageModelSessionStreamResponse).toHaveBeenCalledWith(
        "mock-session-pointer",
        "mock-composed-prompt",
        JSON.stringify({ temperature: 0.8 }),
        expect.any(Function),
      );
    });

    it("cancels the request after an early break, and ignores late chunks", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(
        (_streamRef: unknown, _ui: unknown, _cbPointer: unknown) => {
          // Send a single chunk, then stop — the final call comes later.
          setTimeout(() => {
            lastRegisteredCallback?.(0, "Hello", 5, null);
          }, 0);
        },
      );

      const session = new LanguageModelSession();
      const chunks: string[] = [];
      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
        break; // consumer breaks early — the native stream is still running
      }
      expect(chunks).toEqual(["Hello"]);
      // Cancelling ends the native stream; the addon absorbs its final call.
      expect(mockFns.FMRequestCancel).toHaveBeenCalledWith("mock-stream-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-stream-pointer");

      // Late snapshots and the final "cancelled" call are ignored.
      expect(() => lastRegisteredCallback?.(0, "Hello there", 11, null)).not.toThrow();
      expect(() => lastRegisteredCallback?.(255, "Stream cancelled", 16, null)).not.toThrow();
      expect(chunks).toEqual(["Hello"]);
    });

    it("ends with a GenerationError when no snapshot follows the first within 30s", async () => {
      vi.useFakeTimers();
      try {
        mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(() => {});
        const session = new LanguageModelSession();
        const iterator = session.streamResponse("Hi")[Symbol.asyncIterator]();
        const first = iterator.next();
        await vi.advanceTimersByTimeAsync(0);
        // The timer isn't armed before the first snapshot, however long it takes.
        await vi.advanceTimersByTimeAsync(60_000);
        lastRegisteredCallback?.(0, "Hello", 5, null);
        await expect(first).resolves.toEqual({ value: "Hello", done: false });

        // Attach the expectation before the timer fires, so the rejection is handled.
        const second = expect(iterator.next()).rejects.toSatisfy(
          (err) => err instanceof GenerationError && /idle timeout/.test((err as Error).message),
        );
        await vi.advanceTimersByTimeAsync(30_001);
        await second;
        expect(mockFns.FMRequestCancel).toHaveBeenCalledWith("mock-stream-pointer");
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects a stream that was queued when the session was disposed", async () => {
      let finishFirst!: () => void;
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest((..._args: unknown[]) => {
          const cb = lastRegisteredCallback;
          finishFirst = () => cb?.(0, "done", 4, null);
          return "mock-task-pointer";
        }),
      );
      const session = new LanguageModelSession();
      const first = session.respond("Hi");
      const queued = (async () => {
        for await (const _ of session.streamResponse("Hi")) {
          // Consume.
        }
      })();
      await new Promise((resolve) => setTimeout(resolve, 0));
      session.dispose();
      finishFirst();
      await first;
      await expect(queued).rejects.toThrow(/disposed/);
      // The released session was never handed to native code.
      expect(mockFns.FMLanguageModelSessionStreamResponse).not.toHaveBeenCalled();
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
    it("refuses a transcript whose session was disposed, before reaching native code", () => {
      const session = new LanguageModelSession();
      const transcript = session.transcript;
      session.dispose();
      vi.clearAllMocks();
      expect(() => LanguageModelSession.fromTranscript(transcript)).toThrow(FoundationModelsError);
      expect(() => LanguageModelSession.fromTranscript(transcript)).toThrow(/disposed/);
      expect(mockFns.FMLanguageModelSessionCreateFromTranscript).not.toHaveBeenCalled();
    });

    it("creates a session from a transcript", () => {
      const mockTranscript = {
        _nativeSession: "mock-transcript-session-pointer",
        _pointer: () => "mock-transcript-session-pointer",
        // A transcript restored from JSON owns its object; one reached through
        // session.transcript doesn't, and fromTranscript refuses that.
        _ownsObject: true,
        _updateNativeSession: vi.fn(),
      };

      const session = LanguageModelSession.fromTranscript(mockTranscript as never);
      expect(mockFns.FMLanguageModelSessionCreateFromTranscript).toHaveBeenCalledWith(
        "mock-transcript-session-pointer",
        null,
        [],
      );
      expect(session._nativeSession).toBe("mock-session-pointer");
      expect(mockTranscript._updateNativeSession).toHaveBeenCalledWith("mock-session-pointer");
    });

    it("throws when C returns null pointer", () => {
      mockFns.FMLanguageModelSessionCreateFromTranscript.mockReturnValueOnce(null);
      const mockTranscript = {
        _nativeSession: "mock-transcript-session-pointer",
        _pointer: () => "mock-transcript-session-pointer",
        // A transcript restored from JSON owns its object; one reached through
        // session.transcript doesn't, and fromTranscript refuses that.
        _ownsObject: true,
        _updateNativeSession: vi.fn(),
      };

      expect(() => LanguageModelSession.fromTranscript(mockTranscript as never)).toThrow(
        "Failed to create session from transcript",
      );
    });

    it("passes tools when provided", () => {
      const mockTranscript = {
        _nativeSession: "mock-transcript-session-pointer",
        _pointer: () => "mock-transcript-session-pointer",
        // A transcript restored from JSON owns its object; one reached through
        // session.transcript doesn't, and fromTranscript refuses that.
        _ownsObject: true,
        _updateNativeSession: vi.fn(),
      };
      const mockTool = {
        _nativeTool: "mock-tool-pointer",
        _bindToSession: vi.fn(() => mockTool),
        dispose: vi.fn(),
      };

      LanguageModelSession.fromTranscript(mockTranscript as never, {
        tools: [mockTool as never],
      });

      expect(mockTool._bindToSession).toHaveBeenCalled();
    });
  });

  describe("a tool failing the request", () => {
    // The tool side (see tool.test.ts) fails the native call with status 22 and
    // records who did it on the request's budget; the session turns that into
    // a RequestFailedByToolError naming the tool, with the FailRequestError as
    // cause. Simulated here from the native side.
    const failingTool = () => ({
      name: "lookup",
      _nativeTool: "ptr-lookup",
      _bindToSession() {
        return this;
      },
      dispose() {},
      _budgets: new Set<ToolCallBudget>(),
    });
    const cause = new FailRequestError("no such record");
    const failFromNative = (tool: ReturnType<typeof failingTool>) => {
      const message = recordToolFailure(tool._budgets, "lookup", cause);
      lastRegisteredCallback?.(22, message, message.length, null);
    };

    it("rejects respond() with the tool's name and cause", async () => {
      const tool = failingTool();
      const session = new LanguageModelSession({ tools: [tool as never] });
      const promise = session.respond("Look it up.");
      await vi.waitFor(() => expect(tool._budgets.size).toBe(1));
      failFromNative(tool);
      const err = await promise.catch((e) => e);
      expect(err).toBeInstanceOf(RequestFailedByToolError);
      expect(err.toolName).toBe("lookup");
      expect(err.cause).toBe(cause);
      expect(err.message).toBe("Tool 'lookup' failed the request: no such record");
      // The budget is returned once the request settles.
      expect(tool._budgets.size).toBe(0);
    });

    it("rejects a stream the same way", async () => {
      const tool = failingTool();
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(() => {
        setTimeout(() => failFromNative(tool), 0);
      });
      const session = new LanguageModelSession({ tools: [tool as never] });
      const err = await (async () => {
        for await (const _ of session.streamResponse("Look it up.")) {
          // Nothing arrives.
        }
      })().catch((e) => e);
      expect(err).toBeInstanceOf(RequestFailedByToolError);
      expect(err.toolName).toBe("lookup");
      expect(err.cause).toBe(cause);
    });

    it("leaves toolName unset when no tool of this session recorded a failure", async () => {
      const session = new LanguageModelSession();
      const promise = session.respond("Hi");
      queueMicrotask(() => lastRegisteredCallback?.(22, "no such record", 14, null));
      const err = await promise.catch((e) => e);
      expect(err).toBeInstanceOf(RequestFailedByToolError);
      expect(err.toolName).toBeNull();
    });
  });

  describe("constructor with tools", () => {
    it("registers tools and passes tool pointers", () => {
      const mockTool = {
        _nativeTool: "mock-tool-pointer",
        _bindToSession: vi.fn(() => mockTool),
        dispose: vi.fn(),
      };

      new LanguageModelSession({ tools: [mockTool as never] });
      expect(mockTool._bindToSession).toHaveBeenCalled();
    });

    const namedTool = (name: string) => ({
      name,
      _nativeTool: "ptr-" + name,
      _bindToSession() {
        return this;
      },
      dispose() {},
    });

    it("rejects the same tool listed twice", () => {
      const tool = namedTool("lookup");
      expect(() => new LanguageModelSession({ tools: [tool, tool] as never })).toThrow(
        FoundationModelsError,
      );
      expect(() => new LanguageModelSession({ tools: [tool, tool] as never })).toThrow(
        /'lookup' is listed more than once/,
      );
      expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).not.toHaveBeenCalled();
    });

    it("rejects two tools with one name, in the constructor and fromTranscript", () => {
      const tools = [namedTool("lookup"), namedTool("lookup")] as never;
      expect(() => new LanguageModelSession({ tools })).toThrow(/Two tools are named 'lookup'/);
      const transcript = {
        _nativeSession: "t",
        _pointer: () => "t",
        _ownsObject: true,
        _updateNativeSession: vi.fn(),
      } as never;
      expect(() => LanguageModelSession.fromTranscript(transcript, { tools })).toThrow(
        /Two tools are named 'lookup'/,
      );
      expect(mockFns.FMLanguageModelSessionCreateFromTranscript).not.toHaveBeenCalled();
    });

    it("allows different tools with different names", () => {
      const tools = [namedTool("lookup"), namedTool("save")] as never;
      new LanguageModelSession({ tools });
      expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).toHaveBeenCalledWith(
        null,
        null,
        ["ptr-lookup", "ptr-save"],
      );
    });
  });

  describe("_enqueue serialization", () => {
    it("serializes concurrent respond calls", async () => {
      const callOrder: number[] = [];

      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest((..._args: unknown[]) => {
          const text = mockFns.FMComposedPromptAddText.mock.calls.at(-1)?.[1];
          const idx = text === "first" ? 1 : 2;
          callOrder.push(idx);
          setTimeout(() => {
            lastRegisteredCallback?.(0, `Response ${idx}`, 10, null);
          }, 0);
          return "mock-task-pointer";
        }),
      );

      const session = new LanguageModelSession();
      const [r1, r2] = await Promise.all([session.respond("first"), session.respond("second")]);

      expect(r1.content).toBe("Response 1");
      expect(r2.content).toBe("Response 2");
      expect(callOrder).toEqual([1, 2]);
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

    it("cancel() unblocks a waiting stream consumer and cancels the native request", async () => {
      // No snapshots arrive; cancellation supplies the terminal callback.
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(() => {});

      const session = new LanguageModelSession();
      const chunks: string[] = [];

      // Schedule cancel() after the stream has started waiting.
      setTimeout(() => session.cancel(), 10);

      for await (const chunk of session.streamResponse("Hi")) {
        chunks.push(chunk);
      }
      expect(chunks).toEqual([]);
      expect(mockFns.FMRequestCancel).toHaveBeenCalledWith("mock-stream-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-stream-pointer");
    });

    it("keeps a cancelled stream's handle alive through cleanup and unlocks the queue", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(() => {});
      const released = new Set<unknown>();
      mockFns.FMRelease.mockImplementation((handle) => {
        released.add(handle);
      });
      mockFns.FMRequestCancel.mockImplementation((handle) => {
        if (released.has(handle)) throw new Error("The request has been released");
        if (handle === "mock-stream-pointer") lastRegisteredCallback?.(23, "Stream cancelled");
      });
      mockFns.FMLanguageModelSessionRespond.mockImplementationOnce(
        textRequest(() => lastRegisteredCallback?.(0, "after cancel")),
      );
      const session = new LanguageModelSession();
      try {
        const stream = session.streamResponse("Hi");
        const pending = stream.collect();
        await vi.waitFor(() =>
          expect(mockFns.FMLanguageModelSessionStreamResponse).toHaveBeenCalled(),
        );
        const next = session.respond("Again");
        session.cancel();
        session.cancel();
        await expect(pending).resolves.toMatchObject({ content: "" });
        await expect(next).resolves.toMatchObject({ content: "after cancel" });
        expect(released.has("mock-stream-pointer")).toBe(true);
      } finally {
        mockFns.FMRelease.mockImplementation(() => {});
        mockFns.FMRequestCancel.mockImplementation(() => {});
        session.dispose();
      }
    });

    it("unlocks the stream queue even when native cancellation throws during cleanup", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementation(() => {
        queueMicrotask(() => lastRegisteredCallback?.(0, "Hello"));
      });
      mockFns.FMRequestCancel.mockImplementationOnce(() => {
        throw new Error("cleanup failed");
      });
      mockFns.FMLanguageModelSessionRespond.mockImplementationOnce(
        textRequest(() => lastRegisteredCallback?.(0, "after cleanup")),
      );
      const session = new LanguageModelSession();
      try {
        const iterator = session.streamResponse("Hi")[Symbol.asyncIterator]();
        await expect(iterator.next()).resolves.toMatchObject({ value: "Hello" });
        await expect(iterator.return!()).rejects.toThrow("cleanup failed");
        expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-stream-pointer");
        expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
        await expect(session.respond("Again")).resolves.toMatchObject({ content: "after cleanup" });
      } finally {
        session.dispose();
      }
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

  describe("disposed session guard", () => {
    it("throws when reading a live transcript after dispose, instead of using a freed pointer", () => {
      const session = new LanguageModelSession();
      const transcript = session.transcript;
      session.dispose();
      expect(() => transcript.toJson()).toThrow(/Export the transcript before disposing/);
      expect(mockFns.FMLanguageModelSessionGetTranscriptJSONString).not.toHaveBeenCalled();
    });

    it("rejects a disposed SystemLanguageModel instead of falling back to the default", async () => {
      const { SystemLanguageModel } = await import("../../src/core.js");
      const model = new SystemLanguageModel();
      model.dispose();
      expect(() => new LanguageModelSession({ model })).toThrow(
        "SystemLanguageModel has been disposed",
      );
      expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).not.toHaveBeenCalled();
    });

    it("respond throws on disposed session", async () => {
      const session = new LanguageModelSession();
      session.dispose();
      await expect(session.respond("Hi")).rejects.toThrow("Session has been disposed");
    });

    it("respondWithSchema throws on disposed session", async () => {
      const session = new LanguageModelSession();
      session.dispose();
      const mockSchema = { _nativeSchema: "mock-schema-pointer" };
      await expect(session.respondWithSchema("Hi", mockSchema as never)).rejects.toThrow(
        "Session has been disposed",
      );
    });

    it("respondWithJsonSchema throws on disposed session", async () => {
      const session = new LanguageModelSession();
      session.dispose();
      await expect(
        session.respondWithJsonSchema("Hi", { type: "object", properties: {} }),
      ).rejects.toThrow("Session has been disposed");
    });

    it("streamResponse throws on disposed session", async () => {
      const session = new LanguageModelSession();
      session.dispose();
      const chunks: string[] = [];
      try {
        for await (const chunk of session.streamResponse("Hi")) {
          chunks.push(chunk);
        }
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Session has been disposed");
      }
      expect(chunks).toEqual([]);
    });

    it("dispose is idempotent — second call is a no-op", () => {
      const session = new LanguageModelSession();
      session.dispose();
      // FMRelease should have been called once during the first dispose
      const releaseCount = mockFns.FMRelease.mock.calls.length;
      session.dispose(); // second call
      expect(mockFns.FMRelease).toHaveBeenCalledTimes(releaseCount);
    });

    it("cancel is a no-op after dispose", () => {
      const session = new LanguageModelSession();
      session.dispose();
      expect(() => session.cancel()).not.toThrow();
    });

    it("prewarm is a no-op after dispose", () => {
      const session = new LanguageModelSession();
      session.dispose();
      expect(() => session.prewarm("test")).not.toThrow();
      expect(mockFns.FMLanguageModelSessionPrewarm).not.toHaveBeenCalled();
    });

    it("isResponding returns false after dispose", () => {
      const session = new LanguageModelSession();
      session.dispose();
      expect(session.isResponding).toBe(false);
    });
  });

  describe("queued request after dispose", () => {
    it("respond rejects at execution time if disposed while queued", async () => {
      // Verify the execution-time guard: even if the call-time check passes,
      // the private _respondText check catches a mid-queue dispose.
      // We simulate this by manually resolving the queue after dispose.
      const session = new LanguageModelSession();

      // Block the queue with a long-running first request that we control
      let resolveBlocker!: () => void;
      const blocker = new Promise<void>((r) => (resolveBlocker = r));
      // Manually chain a blocker onto the queue so respond() waits
      (session as unknown as { _queue: Promise<void> })._queue = blocker;

      const second = session.respond("second");

      // Dispose while second is waiting in the queue
      session.dispose();

      // Now unblock the queue — _respondText should hit the dispose guard
      resolveBlocker();

      await expect(second).rejects.toThrow("Session has been disposed");
      // The C API should never have been called for the second request
      expect(mockFns.FMLanguageModelSessionRespond).not.toHaveBeenCalled();
    });
  });

  describe("streamResponse setup failure does not stall queue", () => {
    it("releases the queue even if reading usage throws when a stream ends", async () => {
      mockFns.FMLanguageModelSessionResponseStreamIterate.mockImplementationOnce(() => {
        queueMicrotask(() => lastRegisteredCallback?.(0, null, 0, null));
      });
      const session = new LanguageModelSession();
      // Reading usage works at the start of the stream, then fails at the end.
      mockFns.FMLanguageModelSessionGetUsageJSON.mockImplementationOnce(
        () => null,
      ).mockImplementationOnce(() => {
        throw new Error("usage read failed");
      });
      await expect(session.streamResponse("Hi").collect()).rejects.toThrow("usage read failed");

      // The queue must not stay locked.
      mockFns.FMLanguageModelSessionRespond.mockImplementationOnce(
        textRequest(() => {
          setTimeout(() => lastRegisteredCallback?.(0, "after", 5, null), 0);
          return "mock-task-pointer";
        }),
      );
      const { content } = await session.respond("Next");
      expect(content).toBe("after");
    });

    it("subsequent respond() succeeds after streamResponse setup throws", async () => {
      const session = new LanguageModelSession();

      // Make the native stream call throw to simulate a setup failure
      mockFns.FMLanguageModelSessionStreamResponse.mockImplementationOnce(
        streamRequest(() => {
          throw new Error("native stream setup failed");
        }),
      );

      // streamResponse should propagate the error
      const chunks: string[] = [];
      try {
        for await (const chunk of session.streamResponse("Hi")) {
          chunks.push(chunk);
        }
        expect.unreachable("Should have thrown");
      } catch (err) {
        expect((err as Error).message).toBe("native stream setup failed");
      }

      // The queue should NOT be stalled — a subsequent respond() must work.
      // Set up a normal mock response.
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        textRequest(
          (
            _session: unknown,
            _prompt: unknown,
            _opts: unknown,
            _ui: unknown,
            _cbPointer: unknown,
          ) => {
            setTimeout(() => {
              lastRegisteredCallback?.(0, "response text", 13, null);
            }, 0);
            return "mock-task";
          },
        ),
      );

      const result = await session.respond("Next prompt");
      expect(result.content).toBe("response text");
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

describe("Private Cloud Compute sessions", () => {
  it("creates the session with the PCC constructor", () => {
    const model = new PrivateCloudComputeLanguageModel();
    const session = new LanguageModelSession({ model, instructions: "hi" });
    expect(mockFns.FMLanguageModelSessionCreateFromPrivateCloudComputeModel).toHaveBeenCalledWith(
      "mock-pcc-pointer",
      "hi",
      [],
    );
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).not.toHaveBeenCalled();
    expect(session._nativeSession).toBe("mock-pcc-session");
  });

  it("refuses a disposed PCC model instead of passing null to Swift", () => {
    const model = new PrivateCloudComputeLanguageModel();
    model.dispose();
    expect(() => new LanguageModelSession({ model })).toThrow(/disposed/);
    expect(() =>
      LanguageModelSession.fromTranscript({ _nativeSession: "t" } as never, { model }),
    ).toThrow(/disposed/);
    expect(mockFns.FMLanguageModelSessionCreateFromPrivateCloudComputeModel).not.toHaveBeenCalled();
    expect(
      mockFns.FMLanguageModelSessionCreateFromTranscriptWithPrivateCloudComputeModel,
    ).not.toHaveBeenCalled();
  });

  it("skips the on-device regex check", async () => {
    mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementationOnce(
      structuredRequest(() => {
        setTimeout(() => lastRegisteredCallback?.(0, "mock-content-ref", null), 0);
        return "mock-task";
      }),
    );
    const session = new LanguageModelSession({ model: new PrivateCloudComputeLanguageModel() });
    const schema = { type: "object", properties: { v: { type: "string", pattern: "[a-z]+" } } };
    await expect(session.respondWithJsonSchema("x", schema)).resolves.toBeDefined();
  });

  it("still runs the regex check on-device", async () => {
    const session = new LanguageModelSession();
    const schema = { type: "object", properties: { v: { type: "string", pattern: "[a-z]+" } } };
    await expect(session.respondWithJsonSchema("x", schema)).rejects.toBeInstanceOf(
      UnsupportedGuideError,
    );
    expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).not.toHaveBeenCalled();
  });

  it("rejects reasoningLevel on-device before the request", async () => {
    const session = new LanguageModelSession();
    await expect(
      session.respond("x", { options: { reasoningLevel: "deep" } }),
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    expect(mockFns.FMLanguageModelSessionRespond).not.toHaveBeenCalled();
  });

  describe("fromTranscript guards", () => {
    it("refuses a transcript that belongs to a live session", () => {
      const session = new LanguageModelSession();
      expect(() => LanguageModelSession.fromTranscript(session.transcript)).toThrow(
        /belongs to a session/,
      );
      session.dispose();
    });

    it("accepts a transcript restored from JSON", () => {
      const restored = Transcript.fromJson(
        '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[]}}',
      );
      expect(LanguageModelSession.fromTranscript(restored)).toBeInstanceOf(LanguageModelSession);
    });
  });
});
