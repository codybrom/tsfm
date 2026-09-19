import { describe, it, expect, afterAll } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  type Usage,
} from "../../src/index.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

function expectNonZero(usage: Usage) {
  expect(usage.input.totalTokens).toBeGreaterThan(0);
  expect(usage.output.totalTokens).toBeGreaterThan(0);
  expect(usage.input.cachedTokens).toBeLessThanOrEqual(usage.input.totalTokens);
  // The on-device model doesn't reason.
  expect(usage.output.reasoningTokens).toBe(0);
}

function add(a: Usage, b: Usage): Usage {
  return {
    input: {
      totalTokens: a.input.totalTokens + b.input.totalTokens,
      cachedTokens: a.input.cachedTokens + b.input.cachedTokens,
    },
    output: {
      totalTokens: a.output.totalTokens + b.output.totalTokens,
      reasoningTokens: a.output.reasoningTokens + b.output.reasoningTokens,
    },
  };
}

describeIfAvailable("token usage (integration)", () => {
  it("respond() returns content with usage", async () => {
    const session = new LanguageModelSession();
    const response = await session.respond("Say hello in one word.");
    expect(response.content.length).toBeGreaterThan(0);
    expectNonZero(response.usage);
    session.dispose();
  }, 30_000);

  it("respondWithSchema() returns content with usage", async () => {
    const schema = new GenerationSchema("Color", "A color").property("name", "string", {
      guides: [GenerationGuide.anyOf(["red", "blue"])],
    });
    const session = new LanguageModelSession();
    const response = await session.respondWithSchema("Pick a color.", schema);
    expect(["red", "blue"]).toContain(response.content.value<string>("name"));
    expectNonZero(response.usage);
    session.dispose();
  }, 30_000);

  it("streamResponse() reports usage once the stream finishes", async () => {
    const session = new LanguageModelSession();
    const stream = session.streamResponse("Count from 1 to 3.");
    expect(stream.usage).toBeUndefined();
    let text = "";
    for await (const delta of stream) text += delta;
    expect(text.length).toBeGreaterThan(0);
    expect(stream.usage).toBeDefined();
    expectNonZero(stream.usage!);
    session.dispose();
  }, 30_000);

  it("collect() returns the full text with usage", async () => {
    const session = new LanguageModelSession();
    const response = await session.streamResponse("Say hi.").collect();
    expect(response.content.length).toBeGreaterThan(0);
    expectNonZero(response.usage);
    session.dispose();
  }, 30_000);

  it("session.usage is the sum of every response's usage", async () => {
    const session = new LanguageModelSession();
    const a = await session.respond("Say hi.");
    const b = await session.streamResponse("Now say bye.").collect();
    const c = await session.respond("Say thanks.");
    expect(session.usage).toEqual(add(add(a.usage, b.usage), c.usage));
    // Later turns re-read the transcript, so they read more input.
    expect(c.usage.input.totalTokens).toBeGreaterThan(a.usage.input.totalTokens);
    session.dispose();
  }, 60_000);

  it("keeps each queued request's usage separate", async () => {
    const session = new LanguageModelSession();
    // Queued concurrently: each waits for the previous, so none overlaps.
    const stream = session.streamResponse("Name a fruit.");
    const [first, streamed, last] = await Promise.all([
      session.respond("Name a color."),
      stream.collect(),
      session.respond("Name an animal."),
    ]);
    expect(session.usage).toEqual(add(add(first.usage, streamed.usage), last.usage));
    session.dispose();
  }, 60_000);
});
