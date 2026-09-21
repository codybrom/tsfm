import { describe, it, expect, afterAll } from "vitest";
import { SystemLanguageModel, LanguageModelSession } from "../../src/index.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

describeIfAvailable("basic text generation (integration)", () => {
  it("generates a text response", async () => {
    const session = new LanguageModelSession();
    const { content: reply } = await session.respond("Say hello in one word.");
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    session.dispose();
  }, 30_000);

  it("accepts instructions", async () => {
    const session = new LanguageModelSession({
      instructions: "You always respond with exactly the word 'OK'.",
    });
    const { content: reply } = await session.respond("Say something.");
    expect(typeof reply).toBe("string");
    session.dispose();
  }, 30_000);
});
