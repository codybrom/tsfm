import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";
const fn = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({ getFunctions: () => fn }));
import { LanguageModelSession } from "../../src/session.js";
import { Tool, type ToolCallContext } from "../../src/tool.js";
import { GeneratedContent, GenerationSchema } from "../../src/schema.js";
import { Transcript } from "../../src/transcript.js";
import { ToolCallLimitExceededError } from "../../src/errors.js";

class SharedTool extends Tool {
  name = "lookup";
  description = "Look up a fact";
  argumentsSchema = new GenerationSchema("Args");
  #count = 0;
  signals: AbortSignal[] = [];
  async call(_args: GeneratedContent, { signal }: ToolCallContext): Promise<string> {
    this.signals.push(signal);
    return String(++this.#count);
  }
}

beforeEach(() => vi.clearAllMocks());

describe("session tool registrations", () => {
  it.each(
    (["text", "schema", "json", "stream"] as const).flatMap((kind) => [
      { kind, restored: false },
      { kind, restored: true },
    ]),
  )("isolates $kind budgets (restored: $restored)", async ({ kind, restored }) => {
    let nextTool = 0;
    fn.FMBridgedToolCreate.mockImplementation(() => ({
      value: `tool-${nextTool++}`,
      status: 0,
      description: null,
    }));
    const complete: Array<(status: number, message: string) => void> = [];
    fn.FMLanguageModelSessionRespond.mockImplementation(() => [
      new Promise((resolve) => complete.push((status, text) => resolve({ status, text } as never))),
      "request",
    ]);
    const structured = () =>
      [
        new Promise((resolve) =>
          complete.push((status, message) => resolve({ status, message, content: null })),
        ),
        "request",
      ] as never;
    fn.FMLanguageModelSessionRespondWithSchema.mockImplementation(structured);
    fn.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(structured);
    fn.FMLanguageModelSessionStreamResponse.mockImplementation((_s, _p, _o, callback) => {
      complete.push(callback);
      return "request";
    });
    fn.FMBridgedToolFailCall.mockImplementation((tool, _id, status, message) => {
      complete[tool === "tool-0" ? 0 : 1](status, message);
      return true;
    });
    using tool = new SharedTool();
    using a = new LanguageModelSession({ tools: [tool] });
    using b = restored
      ? LanguageModelSession.fromTranscript(Transcript.fromJson("{}"), { tools: [tool] })
      : new LanguageModelSession({ tools: [tool] });
    const run = (session: LanguageModelSession, maximumToolCalls: number) => {
      const opts = { options: { maximumToolCalls } };
      switch (kind) {
        case "text":
          return session.respond("Look up", opts);
        case "schema":
          return session.respondWithSchema("Look up", tool.argumentsSchema, opts);
        case "json":
          return session.respondWithJsonSchema("Look up", { type: "object" }, opts);
        case "stream":
          return session.streamResponse("Look up", opts).collect();
      }
    };
    const first = run(a, 1).catch((error) => error);
    const second = run(b, 2).catch((error) => error);
    await vi.waitFor(() => expect(complete).toHaveLength(2));
    const callA = fn.FMBridgedToolCreate.mock.calls[0][3];
    const callB = fn.FMBridgedToolCreate.mock.calls[1][3];
    callA("a-1", 1);
    await vi.waitFor(() =>
      expect(fn.FMBridgedToolFinishCall).toHaveBeenCalledWith("tool-0", 1, "1"),
    );
    // A has used its entire allowance while both requests are still active.
    callB("b-1", 1);
    callB("b-2", 2);
    await vi.waitFor(() => expect(fn.FMBridgedToolFinishCall).toHaveBeenCalledTimes(3));
    expect(fn.FMBridgedToolFailCall).not.toHaveBeenCalled();
    expect(tool.signals).toHaveLength(3);
    callA("a-excess", 2);
    callB("b-excess", 3);
    expect(await first).toBeInstanceOf(ToolCallLimitExceededError);
    expect(await second).toBeInstanceOf(ToolCallLimitExceededError);
    expect(tool.signals).toHaveLength(3);
  });

  it("disposes only a session's registration and keeps the shared tool usable", async () => {
    using tool = new SharedTool();
    using a = new LanguageModelSession({ tools: [tool] });
    using _b = new LanguageModelSession({ tools: [tool] });
    a.dispose();
    const onCall = vi.fn();
    tool.onCall = onCall;
    fn.FMBridgedToolCreate.mock.calls[1][3]("args", 1);
    await vi.waitFor(() => expect(tool.signals).toHaveLength(1));
    expect(onCall).toHaveBeenCalledWith("lookup", { key: "value" });
    expect(tool.signals[0].aborted).toBe(false);
  });

  it("releases registrations if session construction fails", () => {
    using tool = new SharedTool();
    fn.FMLanguageModelSessionCreateFromSystemLanguageModel.mockReturnValueOnce(null as never);
    expect(() => new LanguageModelSession({ tools: [tool] })).toThrow("Failed to create");
    expect(fn.FMRelease).toHaveBeenCalledWith(fn.FMBridgedToolCreate.mock.results[0].value.value);
  });
});
