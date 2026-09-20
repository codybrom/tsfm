import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({ getFunctions: () => mockFns }));

import { LanguageModelSession } from "../../src/session.js";
import { Tool } from "../../src/tool.js";
import { GenerationSchema } from "../../src/schema.js";
import { FailRequestError, RequestFailedByToolError } from "../../src/errors.js";

beforeEach(() => vi.clearAllMocks());

describe("tool failure routing across concurrent sessions", () => {
  it.each(
    (["text", "schema", "json", "stream"] as const).flatMap((kind) => [
      { kind, synchronous: true },
      { kind, synchronous: false },
    ]),
  )(
    "preserves each $kind request's cause (synchronous: $synchronous)",
    async ({ kind, synchronous }) => {
      // Identical messages must still identify different invocations and causes.
      const failures = [
        new FailRequestError("lookup failed", { cause: new Error("request A") }),
        new FailRequestError("lookup failed", { cause: new Error("request B") }),
      ];
      class SharedTool extends Tool {
        name = "lookup";
        description = "Look up a record";
        argumentsSchema = new GenerationSchema("Lookup");
        calls = 0;
        call(): Promise<string> {
          const failure = failures[this.calls++];
          if (synchronous) throw failure;
          return Promise.reject(failure);
        }
      }
      const complete: Array<(status: number, message: string) => void> = [];
      mockFns.FMLanguageModelSessionRespond.mockImplementation(
        () =>
          [
            new Promise((resolve) => complete.push((status, text) => resolve({ status, text }))),
            "request",
          ] as never,
      );
      const structured = () =>
        [
          new Promise((resolve) =>
            complete.push((status, message) =>
              resolve({
                status,
                content: null,
                // The bridge encodes a structured error as GeneratedContent JSON.
                message: JSON.stringify(message),
              }),
            ),
          ),
          "request",
        ] as never;
      mockFns.FMLanguageModelSessionRespondWithSchema.mockImplementation(structured);
      mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockImplementation(structured);
      mockFns.FMLanguageModelSessionStreamResponse.mockImplementation((_s, _p, _o, onChunk) => {
        complete.push(onChunk);
        return "stream-request";
      });
      mockFns.FMBridgedToolFailCall.mockImplementation((_tool, id, status, message) => {
        complete[id - 1](status, message);
        return true;
      });

      using tool = new SharedTool();
      using a = new LanguageModelSession({ tools: [tool] });
      using b = new LanguageModelSession({ tools: [tool] });
      const run = (session: LanguageModelSession) => {
        switch (kind) {
          case "text":
            return session.respond("Look it up");
          case "schema":
            return session.respondWithSchema("Look it up", tool.argumentsSchema);
          case "json":
            return session.respondWithJsonSchema("Look it up", { type: "object" });
          case "stream":
            return session.streamResponse("Look it up").collect();
        }
      };
      const results = Promise.all([run(a).catch((e) => e), run(b).catch((e) => e)]);
      await vi.waitFor(() => expect(complete).toHaveLength(2));
      const onCall = mockFns.FMBridgedToolCreate.mock.calls[0][3];
      onCall("arguments-a", 1);
      mockFns.FMBridgedToolCreate.mock.calls[1][3]("arguments-b", 2);

      const errors = await results;
      for (const [i, error] of errors.entries()) {
        expect(error).toBeInstanceOf(RequestFailedByToolError);
        expect(error.toolName).toBe("lookup");
        expect(error.cause).toBe(failures[i]);
        expect(error.message).toBe("Tool 'lookup' failed the request: lookup failed");
      }
      expect(mockFns.FMBridgedToolFinishCall).not.toHaveBeenCalled();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("arguments-a");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("arguments-b");
      expect(tool._budgets.size).toBe(0);
    },
  );
});
