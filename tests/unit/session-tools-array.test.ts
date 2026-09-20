import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({ getFunctions: () => mockFns }));

import { LanguageModelSession } from "../../src/session.js";
import { Tool } from "../../src/tool.js";
import { GenerationSchema } from "../../src/schema.js";
import { Transcript } from "../../src/transcript.js";
import { ToolCallLimitExceededError } from "../../src/errors.js";

class Lookup extends Tool {
  name = "lookup";
  description = "Look up a fact";
  argumentsSchema = new GenerationSchema("Args");
  call = vi.fn(async () => "answer");
}

let complete: (result: { status: number; text: string }) => void;
beforeEach(() => {
  vi.clearAllMocks();
  mockFns.FMLanguageModelSessionRespond.mockImplementation(
    () => [new Promise((resolve) => (complete = resolve)), "request"] as never,
  );
  mockFns.FMBridgedToolFinishCall.mockImplementation(() => {
    complete({ status: 0, text: "answer" });
    return true;
  });
  mockFns.FMBridgedToolFailCall.mockImplementation((_tool, _id, status, text) => {
    complete({ status, text });
    return true;
  });
});

const factories = {
  constructor: (tools: Tool[]) => new LanguageModelSession({ tools }),
  fromTranscript: (tools: Tool[]) =>
    LanguageModelSession.fromTranscript(Transcript.fromJson("{}"), { tools }),
};

for (const [name, create] of Object.entries(factories)) {
  describe(`${name} tools array ownership`, () => {
    it("enforces the budget after the caller clears the tools array", async () => {
      using tool = new Lookup();
      const tools: Tool[] = [tool];
      using session = create(tools);
      tools.length = 0;
      const pending = session.respond("Look it up", { options: { maximumToolCalls: 0 } });
      const rejected = expect(pending).rejects.toBeInstanceOf(ToolCallLimitExceededError);
      await vi.waitFor(() => expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled());
      mockFns.FMBridgedToolCreate.mock.calls[0][3]("arguments", 1);
      await rejected;
      expect(tool.call).not.toHaveBeenCalled();
      expect(tool._budgets.size).toBe(0);
    });

    it("cleans up the budget after the caller replaces tools during a request", async () => {
      using tool = new Lookup();
      using replacement = new Lookup();
      const tools: Tool[] = [tool];
      using session = create(tools);
      const pending = session.respond("Look it up", { options: { maximumToolCalls: 1 } });
      await vi.waitFor(() => expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled());
      tools.splice(0, 1, replacement);
      const onCall = mockFns.FMBridgedToolCreate.mock.calls[0][3];
      onCall("arguments", 1);
      await pending;
      expect(tool._budgets.size).toBe(0);
      const next = session.respond("Look it up again", { options: { maximumToolCalls: 1 } });
      await vi.waitFor(() =>
        expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalledTimes(2),
      );
      onCall("arguments", 2);
      await expect(next).resolves.toHaveProperty("content", "answer");
      expect(tool.call).toHaveBeenCalledTimes(2);
      expect(replacement.call).not.toHaveBeenCalled();
      expect(tool._budgets.size).toBe(0);
    });
  });
}
