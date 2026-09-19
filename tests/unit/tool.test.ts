import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFns, mockKoffi, capturedCallbacks, capturedRegistryCallback } = vi.hoisted(() => {
  const capturedCallbacks: Array<(contentRef: unknown, callId: number) => void> = [];
  let registryCb: ((held: { pointer: unknown; callback: unknown }) => void) | null = null;
  globalThis.FinalizationRegistry = class MockFinalizationRegistry {
    constructor(callback: (held: { pointer: unknown; callback: unknown }) => void) {
      registryCb = callback;
    }
    register() {}
    unregister() {}
  } as unknown as typeof FinalizationRegistry;
  return {
    mockFns: {
      FMBridgedToolCreate: vi.fn((): string | null => "mock-tool-pointer"),
      FMBridgedToolFinishCall: vi.fn(),
      FMBridgedToolFailCall: vi.fn(),
      FMRelease: vi.fn(),
    },
    mockKoffi: {
      register: vi.fn((cb: unknown, _proto: unknown) => {
        capturedCallbacks.push(cb as (contentRef: unknown, callId: number) => void);
        return "mock-cb-pointer";
      }),
      unregister: vi.fn(),
      pointer: vi.fn((_proto: unknown) => "mock-proto-pointer"),
    },
    capturedCallbacks,
    capturedRegistryCallback: () => registryCb,
  };
});

vi.mock("koffi", () => ({
  default: mockKoffi,
}));

vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeAndFreeString: vi.fn(),
  unregisterCallback: (pointer: unknown) => mockKoffi.unregister(pointer),
  ToolCallbackProto: "ToolCallbackProto",
}));

const { shouldThrowOnConstruct, mockContentDispose } = vi.hoisted(() => ({
  shouldThrowOnConstruct: { value: false as boolean | string },
  mockContentDispose: vi.fn(),
}));

vi.mock("../../src/schema.js", () => ({
  GenerationSchema: class MockSchema {
    _nativeSchema = "mock-schema-pointer";
  },
  GeneratedContent: class MockContent {
    _nativeContent: unknown;
    constructor(pointer: unknown) {
      if (shouldThrowOnConstruct.value === true) throw new Error("construct failed");
      if (shouldThrowOnConstruct.value) throw shouldThrowOnConstruct.value;
      this._nativeContent = pointer;
    }
    toObject() {
      return {};
    }
    dispose() {
      mockContentDispose(this._nativeContent);
    }
  },
}));

vi.mock("../../src/errors.js", () => ({
  GenerationErrorCode: { TOOL_CALL_LIMIT_EXCEEDED: 15 },
  statusToError: vi.fn((_code: number, msg?: string) => new Error(msg ?? "mock error")),
  ToolCallError: class extends Error {
    toolName: string;
    constructor(toolName: string, cause: Error) {
      super(`Tool '${toolName}' failed: ${cause.message}`);
      this.toolName = toolName;
    }
  },
}));

import { Tool } from "../../src/tool.js";
import { ToolCallBudget } from "../../src/tool-budget.js";
import { GenerationSchema } from "../../src/schema.js";

class TestTool extends Tool {
  readonly name = "test-tool";
  readonly description = "A test tool";
  readonly argumentsSchema = new GenerationSchema("TestArgs");

  async call(): Promise<string> {
    return "result";
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  capturedCallbacks.length = 0;
});

describe("Tool", () => {
  it("_register creates the C tool via FMBridgedToolCreate", () => {
    const tool = new TestTool();
    tool._register();
    expect(mockFns.FMBridgedToolCreate).toHaveBeenCalledWith(
      "test-tool",
      "A test tool",
      "mock-schema-pointer",
      "mock-cb-pointer",
      expect.any(Array),
      null,
    );
    expect(tool._nativeTool).toBe("mock-tool-pointer");
  });

  it("_register is idempotent", () => {
    const tool = new TestTool();
    tool._register();
    tool._register();
    expect(mockFns.FMBridgedToolCreate).toHaveBeenCalledTimes(1);
  });

  it("_register throws when argumentsSchema is not initialized", () => {
    class BadTool extends Tool {
      readonly name = "bad-tool";
      readonly description = "Missing schema";
      readonly argumentsSchema = { _nativeSchema: null } as unknown as GenerationSchema;
      async call(): Promise<string> {
        return "";
      }
    }
    const tool = new BadTool();
    expect(() => tool._register()).toThrow("argumentsSchema must be fully initialized");
  });

  it("_register throws when C returns null", () => {
    mockFns.FMBridgedToolCreate.mockReturnValueOnce(null);
    const tool = new TestTool();
    expect(() => tool._register()).toThrow();
  });

  it("dispose releases pointer and unregisters callback", () => {
    const tool = new TestTool();
    tool._register();
    vi.clearAllMocks();
    tool.dispose();
    expect(mockKoffi.unregister).toHaveBeenCalledWith("mock-cb-pointer");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-tool-pointer");
    expect(tool._nativeTool).toBeNull();
  });

  it("dispose is safe to call twice", () => {
    const tool = new TestTool();
    tool._register();
    tool.dispose();
    vi.clearAllMocks();
    tool.dispose();
    expect(mockKoffi.unregister).not.toHaveBeenCalled();
    expect(mockFns.FMRelease).not.toHaveBeenCalled();
  });

  describe("koffi callback handler", () => {
    it("calls FMBridgedToolFinishCall with the result on success", async () => {
      const tool = new TestTool();
      tool._register();

      expect(capturedCallbacks).toHaveLength(1);
      const callback = capturedCallbacks[0];

      // Invoke the captured callback as if the C side called it
      callback("mock-content-ref", 42);

      // Wait for the async call() to resolve
      await vi.waitFor(() => {
        expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(1);
      });

      expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
        "mock-tool-pointer",
        42,
        "result",
      );
    });

    it("calls FMBridgedToolFinishCall with error message when call() throws an Error", async () => {
      class FailingTool extends Tool {
        readonly name = "failing-tool";
        readonly description = "A tool that fails";
        readonly argumentsSchema = new GenerationSchema("FailArgs");

        async call(): Promise<string> {
          throw new Error("something went wrong");
        }
      }

      const tool = new FailingTool();
      tool._register();

      const callback = capturedCallbacks[0];
      callback("mock-content-ref", 99);

      await vi.waitFor(() => {
        expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(1);
      });

      expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
        "mock-tool-pointer",
        99,
        "Tool 'failing-tool' failed: something went wrong",
      );
    });

    it("calls FMBridgedToolFinishCall with error message when call() throws a non-Error", async () => {
      class StringThrowingTool extends Tool {
        readonly name = "string-thrower";
        readonly description = "A tool that throws a string";
        readonly argumentsSchema = new GenerationSchema("ThrowArgs");

        async call(): Promise<string> {
          throw "raw string error";
        }
      }

      const tool = new StringThrowingTool();
      tool._register();

      const callback = capturedCallbacks[0];
      callback("mock-content-ref", 7);

      await vi.waitFor(() => {
        expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(1);
      });

      expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
        "mock-tool-pointer",
        7,
        "Tool 'string-thrower' failed: raw string error",
      );
    });

    it("passes contentRef to GeneratedContent and then to call()", async () => {
      const callSpy = vi.fn().mockResolvedValue("ok");

      class SpyTool extends Tool {
        readonly name = "spy-tool";
        readonly description = "A spy tool";
        readonly argumentsSchema = new GenerationSchema("SpyArgs");

        call = callSpy;
      }

      const tool = new SpyTool();
      tool._register();

      const callback = capturedCallbacks[0];
      callback("special-content-ref", 1);

      await vi.waitFor(() => {
        expect(callSpy).toHaveBeenCalledTimes(1);
      });

      // The callback should have created a GeneratedContent with the contentRef
      const contentArg = callSpy.mock.calls[0][0];
      expect(contentArg._nativeContent).toBe("special-content-ref");
    });

    it("finishes call with error when GeneratedContent constructor throws synchronously", async () => {
      const tool = new TestTool();
      tool._register();

      shouldThrowOnConstruct.value = true;
      try {
        const callback = capturedCallbacks[0];
        callback("bad-content-ref", 55);

        await vi.waitFor(() => {
          expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(1);
        });

        expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
          "mock-tool-pointer",
          55,
          "Tool callback error: construct failed",
        );
      } finally {
        shouldThrowOnConstruct.value = false;
      }
    });

    it("handles non-Error synchronous throws in callback", async () => {
      const tool = new TestTool();
      tool._register();

      shouldThrowOnConstruct.value = "raw string crash";
      try {
        const callback = capturedCallbacks[0];
        callback("bad-content-ref", 66);

        await vi.waitFor(() => {
          expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(1);
        });

        expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
          "mock-tool-pointer",
          66,
          "Tool callback error: raw string crash",
        );
      } finally {
        shouldThrowOnConstruct.value = false;
      }
    });
  });

  describe("tool-call budget (maximumToolCalls)", () => {
    it("runs calls while the request's budget has room, then fails the next one", async () => {
      const tool = new TestTool();
      const calls = vi.spyOn(tool, "call");
      tool._register();
      const budget = new ToolCallBudget(2);
      tool._budgets.add(budget);
      const callback = capturedCallbacks[0];

      callback("ref-1", 1);
      callback("ref-2", 2);
      callback("ref-3", 3);

      await vi.waitFor(() => expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(2));
      expect(calls).toHaveBeenCalledTimes(2);
      expect(budget.used).toBe(2);
      // The third call isn't run: it's failed with TOOL_CALL_LIMIT_EXCEEDED,
      // which ends the response, and its arguments are released.
      expect(mockFns.FMBridgedToolFailCall).toHaveBeenCalledTimes(1);
      expect(mockFns.FMBridgedToolFailCall).toHaveBeenCalledWith(
        "mock-tool-pointer",
        3,
        15,
        expect.stringMatching(/limit of 2 tool calls.*'test-tool' was not run/),
      );
      expect(mockContentDispose).toHaveBeenCalledWith("ref-3");
    });

    it("doesn't fire onCall for a refused call", () => {
      const tool = new TestTool();
      tool.onCall = vi.fn();
      tool._register();
      tool._budgets.add(new ToolCallBudget(0));
      capturedCallbacks[0]("ref", 1);
      expect(tool.onCall).not.toHaveBeenCalled();
      expect(mockFns.FMBridgedToolFailCall).toHaveBeenCalledTimes(1);
    });

    it("respects every attached budget when a tool is shared by two requests", () => {
      const tool = new TestTool();
      tool._register();
      const roomy = new ToolCallBudget(10);
      const spent = new ToolCallBudget(1);
      spent.used = 1;
      tool._budgets.add(roomy).add(spent);
      capturedCallbacks[0]("ref", 1);
      expect(mockFns.FMBridgedToolFailCall).toHaveBeenCalledTimes(1);
      expect(roomy.used).toBe(0);
    });

    it("runs normally with no budget attached", async () => {
      const tool = new TestTool();
      tool._register();
      capturedCallbacks[0]("ref", 1);
      await vi.waitFor(() => expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledTimes(1));
      expect(mockFns.FMBridgedToolFailCall).not.toHaveBeenCalled();
    });
  });

  describe("Symbol.dispose", () => {
    it("delegates to dispose()", () => {
      const tool = new TestTool();
      tool._register();
      vi.clearAllMocks();
      tool[Symbol.dispose]();
      expect(mockKoffi.unregister).toHaveBeenCalledWith("mock-cb-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-tool-pointer");
      expect(tool._nativeTool).toBeNull();
    });
  });

  describe("FinalizationRegistry cleanup", () => {
    it("unregisters callback and releases pointer when GC fires", () => {
      const cleanup = capturedRegistryCallback();
      expect(cleanup).toBeTypeOf("function");
      cleanup!({ pointer: "gc-tool-pointer", callback: "gc-cb-pointer" });
      expect(mockKoffi.unregister).toHaveBeenCalledWith("gc-cb-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("gc-tool-pointer");
    });

    it("swallows errors from koffi.unregister in GC callback", () => {
      mockKoffi.unregister.mockImplementationOnce(() => {
        throw new Error("already unregistered");
      });
      const cleanup = capturedRegistryCallback();
      // Should not throw, and should still attempt FMRelease
      expect(() => cleanup!({ pointer: "gc-pointer", callback: "bad-cb" })).not.toThrow();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("gc-pointer");
    });

    it("swallows errors from FMRelease in GC callback", () => {
      mockFns.FMRelease.mockImplementationOnce(() => {
        throw new Error("already freed");
      });
      const cleanup = capturedRegistryCallback();
      expect(() => cleanup!({ pointer: "bad-pointer", callback: "gc-cb" })).not.toThrow();
    });
  });
});
