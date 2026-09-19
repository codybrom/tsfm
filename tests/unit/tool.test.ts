import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFns, capturedCallbacks } = vi.hoisted(() => {
  const capturedCallbacks: Array<(contentRef: unknown, callId: number) => void> = [];
  const ok = (value: unknown) => ({ value, status: 0, description: null });
  return {
    mockFns: {
      // The addon hands each tool call to the onCall function it was given.
      FMBridgedToolCreate: vi.fn(
        (_name: string, _description: string, _schema: unknown, onCall: unknown) => {
          capturedCallbacks.push(onCall as (contentRef: unknown, callId: number) => void);
          return ok("mock-tool-pointer") as {
            value: string | null;
            status: number;
            description: string | null;
          };
        },
      ),
      FMBridgedToolFinishCall: vi.fn(() => true),
      FMBridgedToolFailCall: vi.fn(() => true),
      FMRelease: vi.fn(),
    },
    capturedCallbacks,
  };
});

vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
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
      expect.any(Function),
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
    mockFns.FMBridgedToolCreate.mockReturnValueOnce({
      value: null,
      status: 10,
      description: "bad schema",
    });
    const tool = new TestTool();
    expect(() => tool._register()).toThrow();
  });

  it("dispose releases the tool", () => {
    const tool = new TestTool();
    tool._register();
    vi.clearAllMocks();
    tool.dispose();
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-tool-pointer");
    expect(tool._nativeTool).toBeNull();
  });

  it("dispose is safe to call twice", () => {
    const tool = new TestTool();
    tool._register();
    tool.dispose();
    vi.clearAllMocks();
    tool.dispose();
    expect(mockFns.FMRelease).not.toHaveBeenCalled();
  });

  it("ignores a call that arrives after dispose, which the addon has already failed", () => {
    const tool = new TestTool();
    tool._register();
    tool.dispose();
    capturedCallbacks[0]("late-ref", 9);
    expect(mockFns.FMBridgedToolFinishCall).not.toHaveBeenCalled();
    expect(mockFns.FMBridgedToolFailCall).not.toHaveBeenCalled();
  });

  it("doesn't answer through a released handle when onCall disposes the tool", async () => {
    const tool = new TestTool();
    tool.onCall = () => tool.dispose();
    tool._register();
    shouldThrowOnConstruct.value = false;
    capturedCallbacks[0]("ref", 3);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockFns.FMBridgedToolFinishCall).not.toHaveBeenCalled();
  });

  describe("tool call handler", () => {
    it("releases the arguments once call() resolves", async () => {
      const tool = new TestTool();
      tool._register();
      capturedCallbacks[0]("ok-ref", 1);
      await vi.waitFor(() => expect(mockContentDispose).toHaveBeenCalledWith("ok-ref"));
      expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
        "mock-tool-pointer",
        1,
        "result",
      );
    });

    it("releases the arguments once call() rejects", async () => {
      class Rejecting extends TestTool {
        async call(): Promise<string> {
          throw new Error("nope");
        }
      }
      const tool = new Rejecting();
      tool._register();
      capturedCallbacks[0]("reject-ref", 2);
      await vi.waitFor(() => expect(mockContentDispose).toHaveBeenCalledWith("reject-ref"));
    });

    it("releases the arguments when call() throws synchronously", () => {
      class Throwing extends TestTool {
        call(): Promise<string> {
          throw new Error("sync boom");
        }
      }
      const tool = new Throwing();
      tool._register();
      capturedCallbacks[0]("sync-ref", 3);
      expect(mockContentDispose).toHaveBeenCalledWith("sync-ref");
      expect(mockFns.FMBridgedToolFinishCall).toHaveBeenCalledWith(
        "mock-tool-pointer",
        3,
        "Tool callback error: sync boom",
      );
    });

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
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-tool-pointer");
      expect(tool._nativeTool).toBeNull();
    });
  });
});
