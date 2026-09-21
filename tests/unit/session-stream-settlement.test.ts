import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";
const fn = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({ getFunctions: () => fn }));
import { LanguageModelSession } from "../../src/session.js";

beforeEach(() => {
  vi.clearAllMocks();
  fn.FMLanguageModelSessionRespond.mockImplementation(() => [
    Promise.resolve({ status: 0, text: "next" }) as never,
    "next-request",
  ]);
});

describe("native stream settlement", () => {
  it.each(["cancel", "return"] as const)(
    "waits for native completion after %s before reusing a session",
    async (how) => {
      using session = new LanguageModelSession();
      const iterator = session.streamResponse("First")[Symbol.asyncIterator]();
      const first = iterator.next();
      await vi.waitFor(() => expect(fn.FMLanguageModelSessionStreamResponse).toHaveBeenCalled());
      const onChunk = fn.FMLanguageModelSessionStreamResponse.mock.calls[0][3];
      onChunk(0, "hello");
      await first;
      const next = session.respond("Next");
      if (how === "cancel") session.cancel();
      const finished = how === "cancel" ? iterator.next() : iterator.return!();
      await new Promise((resolve) => setImmediate(resolve));
      const startedBeforeNativeCompletion = fn.FMLanguageModelSessionRespond.mock.calls.length;
      onChunk(0, "late snapshot");
      onChunk(23, "Stream cancelled");
      await finished;
      await expect(next).resolves.toMatchObject({ content: "next" });
      expect(startedBeforeNativeCompletion).toBe(0);
    },
  );
});
