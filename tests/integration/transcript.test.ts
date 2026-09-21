import { describe, it, expect, afterAll } from "vitest";
import { SystemLanguageModel, LanguageModelSession, Transcript } from "../../src/index.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

describeIfAvailable("transcript (integration)", () => {
  it("exports and imports transcript JSON", async () => {
    const session = new LanguageModelSession();
    await session.respond("My favorite color is blue.");

    const json = session.transcript.toJson();
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveProperty("type");

    const restored = Transcript.fromJson(json);
    expect(restored._nativeSession).toBeTruthy();
    session.dispose();
  }, 30_000);

  it("resumes session from transcript", async () => {
    const session = new LanguageModelSession();
    await session.respond("My name is TestUser.");
    const json = session.transcript.toJson();
    session.dispose();

    const transcript = Transcript.fromJson(json);
    const resumed = LanguageModelSession.fromTranscript(transcript);
    const { content: reply } = await resumed.respond("What is my name?");
    expect(typeof reply).toBe("string");
    expect(reply.length).toBeGreaterThan(0);
    resumed.dispose();
  }, 30_000);
});
