import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";
const fn = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({ getFunctions: () => fn }));
import { Tool, type ToolCallContext } from "../../src/tool.js";
import { GeneratedContent, GenerationSchema } from "../../src/schema.js";
import { CancelledError } from "../../src/errors.js";

class CancellableTool extends Tool {
  name = "lookup";
  description = "Look up a fact";
  argumentsSchema = new GenerationSchema("Args");
  calls: Array<{ signal: AbortSignal; resolve: (output: string) => void }> = [];
  constructor(private cooperative = true) {
    super();
  }
  async call(_args: GeneratedContent, { signal }: ToolCallContext): Promise<string> {
    const result = Promise.withResolvers<string>();
    this.calls.push({ signal, resolve: result.resolve });
    if (this.cooperative) {
      signal.throwIfAborted();
      signal.addEventListener("abort", () => result.reject(signal.reason), { once: true });
    }
    return result.promise;
  }
}

beforeEach(() => vi.clearAllMocks());

describe("tool invocation cancellation", () => {
  it("aborts only the matching invocation and releases its arguments", async () => {
    using tool = new CancellableTool();
    tool._register();
    const callback = fn.FMBridgedToolCreate.mock.calls[0][3];
    callback("first", 1);
    callback("second", 2);
    await vi.waitFor(() => expect(tool.calls).toHaveLength(2));
    const [first, second] = tool.calls;
    callback(null, 1, true);
    expect(first.signal.aborted).toBe(true);
    expect(first.signal.reason).toBeInstanceOf(CancelledError);
    expect(second.signal.aborted).toBe(false);
    await vi.waitFor(() => expect(fn.FMRelease).toHaveBeenCalledWith("first"));
    expect(fn.FMBridgedToolFinishCall).not.toHaveBeenCalled();
    expect(fn.FMBridgedToolFailCall).not.toHaveBeenCalled();
    second.resolve("answer");
    await vi.waitFor(() =>
      expect(fn.FMBridgedToolFinishCall).toHaveBeenCalledWith(tool._nativeTool, 2, "answer"),
    );
    callback(null, 2, true);
    expect(second.signal.aborted).toBe(false);
  });

  it("ignores late output from a noncooperative tool without releasing arguments early", async () => {
    using tool = new CancellableTool(false);
    tool._register();
    const callback = fn.FMBridgedToolCreate.mock.calls[0][3];
    callback("args", 1);
    await vi.waitFor(() => expect(tool.calls).toHaveLength(1));
    const onAbort = vi.fn();
    tool.calls[0].signal.addEventListener("abort", onAbort);
    callback(null, 1, true);
    callback(null, 1, true);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(fn.FMRelease).not.toHaveBeenCalledWith("args");
    tool.calls[0].resolve("too late");
    await vi.waitFor(() => expect(fn.FMRelease).toHaveBeenCalledWith("args"));
    expect(fn.FMBridgedToolFinishCall).not.toHaveBeenCalled();
    expect(fn.FMBridgedToolFailCall).not.toHaveBeenCalled();
  });

  it("aborts all pending invocations on disposal and ignores old registration events", async () => {
    using tool = new CancellableTool();
    tool._register();
    const old = fn.FMBridgedToolCreate.mock.calls[0][3];
    old("old-1", 1);
    old("old-2", 2);
    await vi.waitFor(() => expect(tool.calls).toHaveLength(2));
    tool.dispose();
    expect(tool.calls.every(({ signal }) => signal.aborted)).toBe(true);
    tool._register();
    const current = fn.FMBridgedToolCreate.mock.calls[1][3];
    current("new", 1);
    await vi.waitFor(() => expect(tool.calls).toHaveLength(3));
    old(null, 1, true);
    expect(tool.calls[2].signal.aborted).toBe(false);
    current(null, 1, true);
    expect(tool.calls[2].signal.aborted).toBe(true);
    await vi.waitFor(() => expect(fn.FMRelease).toHaveBeenCalledWith("new"));
    expect(fn.FMBridgedToolFinishCall).not.toHaveBeenCalled();
  });

  it("isolates equal call IDs across sessions and aborts all registrations on tool disposal", async () => {
    using tool = new CancellableTool();
    using _first = tool._bindToSession();
    using _second = tool._bindToSession();
    const a = fn.FMBridgedToolCreate.mock.calls[0][3];
    const b = fn.FMBridgedToolCreate.mock.calls[1][3];
    a("a", 1);
    b("b", 1);
    await vi.waitFor(() => expect(tool.calls).toHaveLength(2));
    a(null, 1, true);
    expect(tool.calls[0].signal.aborted).toBe(true);
    expect(tool.calls[1].signal.aborted).toBe(false);
    tool.dispose();
    expect(tool.calls[1].signal.aborted).toBe(true);
    using _third = tool._bindToSession();
    const c = fn.FMBridgedToolCreate.mock.calls[2][3];
    c("c", 1);
    await vi.waitFor(() => expect(tool.calls).toHaveLength(3));
    b(null, 1, true);
    expect(tool.calls[2].signal.aborted).toBe(false);
  });

  it("doesn't invoke the body when onCall disposes the tool", async () => {
    using tool = new CancellableTool();
    tool.onCall = () => tool.dispose();
    tool._register();
    fn.FMBridgedToolCreate.mock.calls[0][3]("args", 1);
    await vi.waitFor(() => expect(fn.FMRelease).toHaveBeenCalledWith("args"));
    expect(tool.calls).toHaveLength(0);
  });
});
