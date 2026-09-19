import { describe, it, expect, afterAll } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  UnsupportedGuideError,
} from "../../src/index.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

function schemaWith(pattern: string) {
  return new GenerationSchema("Code", "A code").property("value", "string", {
    guides: [GenerationGuide.regex(pattern)],
  });
}

describeIfAvailable("regex guides (integration)", () => {
  // Patterns the validator accepts must actually generate matching output.
  it.each([
    [String.raw`\d{4}-\d{2}`, /^\d{4}-\d{2}$/],
    ["(yes|no)", /^(yes|no)$/],
    [String.raw`\w+@\w+\.com`, /^\w+@\w+\.com$/],
    [String.raw`\(\d+\)`, /^\(\d+\)$/],
  ])(
    "generates a value matching %s",
    async (pattern, matches) => {
      const session = new LanguageModelSession();
      const { content } = await session.respondWithSchema("Make one up.", schemaWith(pattern));
      expect(content.value<string>("value")).toMatch(matches);
      session.dispose();
    },
    30_000,
  );

  it("rejects an unsupported pattern before calling the model", async () => {
    const session = new LanguageModelSession();
    const started = Date.now();
    const error = await session.respondWithSchema("Make one up.", schemaWith("[a-z]+")).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UnsupportedGuideError);
    expect((error as Error).message).toMatch(
      /character class.*"\[a-z\]\+" at \$\.properties\.value/,
    );
    // No model round trip.
    expect(Date.now() - started).toBeLessThan(100);
    session.dispose();
  });

  it("rejects (?:...) instead of letting the response fill the context window", async () => {
    const session = new LanguageModelSession();
    await expect(
      session.respondWithJsonSchema("Make one up.", {
        type: "object",
        properties: { v: { type: "string", pattern: "(?:ab)+" } },
        required: ["v"],
      }),
    ).rejects.toThrow(/\(\?\.\.\.\) group/);
    session.dispose();
  });
});
