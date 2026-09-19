import { describe, it, expect, afterAll } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
} from "../../src/index.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

describeIfAvailable("structured output (integration)", () => {
  it("generates content matching schema", async () => {
    const schema = new GenerationSchema("Color", "A color")
      .property("name", "string", {
        description: "Color name",
        guides: [GenerationGuide.anyOf(["red", "blue", "green"])],
      })
      .property("isPrimary", "boolean", {
        description: "Whether this is a primary color",
      });

    const session = new LanguageModelSession();
    const { content } = await session.respondWithSchema("Pick a color", schema);
    const name = content.value<string>("name");
    expect(["red", "blue", "green"]).toContain(name);
    const isPrimary = content.value<boolean>("isPrimary");
    expect(typeof isPrimary).toBe("boolean");
    session.dispose();
  }, 30_000);

  it("generates content from JSON schema", async () => {
    const schema = new GenerationSchema("YesNo", "A yes or no answer").property(
      "answer",
      "string",
      {
        guides: [GenerationGuide.anyOf(["yes", "no"])],
      },
    );

    const session = new LanguageModelSession();
    const { content } = await session.respondWithJsonSchema("Is the sky blue?", schema.toDict());
    const obj = content.toObject();
    expect(obj).toHaveProperty("answer");
    expect(["yes", "no"]).toContain(obj.answer);
    session.dispose();
  }, 30_000);
});
