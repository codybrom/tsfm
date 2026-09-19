import { describe, it, expect, afterAll } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  GenerationError,
  ExceededContextWindowSizeError,
  UnsupportedGuideError,
} from "../../src/index.js";

/*
 * Pins how framework errors reach TypeScript. The bridge has to recognize the
 * error type the framework throws. A dylib linked against the macOS 27 SDK
 * receives LanguageModelError instead of LanguageModelSession.GenerationError,
 * and a bridge that misses it reports every failure as "Unknown error (code 255)".
 * These tests catch that regression; nothing else in the suite exercises an
 * error path.
 */

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

/** Well past the on-device context window (8,192 tokens on macOS 27). */
const OVERSIZED_PROMPT =
  "Summarize this: " + "The river flows past the quiet garden by the old library. ".repeat(900);

/** Rejects with `type`, and never with the bridge's catch-all "Unknown error". */
async function expectTypedError(promise: Promise<unknown>, type: new (...args: never[]) => Error) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(type);
  expect(error).toBeInstanceOf(GenerationError);
  expect((error as Error).message).not.toMatch(/Unknown error/);
}

describeIfAvailable("error mapping (integration)", () => {
  it("maps a context overflow from respond()", async () => {
    const session = new LanguageModelSession();
    await expectTypedError(session.respond(OVERSIZED_PROMPT), ExceededContextWindowSizeError);
    session.dispose();
  }, 30_000);

  it("maps a context overflow from streamResponse()", async () => {
    const session = new LanguageModelSession();
    const drain = async () => {
      for await (const _chunk of session.streamResponse(OVERSIZED_PROMPT)) {
        // Draining until the stream throws.
      }
    };
    await expectTypedError(drain(), ExceededContextWindowSizeError);
    session.dispose();
  }, 30_000);

  // On-device, the macOS 27 model rejects regex character classes such as
  // [a-z] (literals, \d and alternation still work). If an OS update starts
  // accepting them, this test fails and the guide docs need updating.
  it("maps an unsupported regex guide from respondWithSchema()", async () => {
    const schema = new GenerationSchema("Code", "A code").property("value", "string", {
      guides: [GenerationGuide.regex("[a-z]+")],
    });
    const session = new LanguageModelSession();
    await expectTypedError(
      session.respondWithSchema("Make one up.", schema),
      UnsupportedGuideError,
    );
    session.dispose();
  }, 30_000);

  it("maps an unsupported regex guide from respondWithJsonSchema()", async () => {
    const schema = new GenerationSchema("Code", "A code").property("value", "string", {
      guides: [GenerationGuide.regex("[0-9]+")],
    });
    const session = new LanguageModelSession();
    await expectTypedError(
      session.respondWithJsonSchema("Make one up.", schema.toDict()),
      UnsupportedGuideError,
    );
    session.dispose();
  }, 30_000);

  it("keeps working after a failed request", async () => {
    const session = new LanguageModelSession();
    await expectTypedError(session.respond(OVERSIZED_PROMPT), ExceededContextWindowSizeError);
    const { content: reply } = await session.respond("Say hello in one word.");
    expect(reply.length).toBeGreaterThan(0);
    session.dispose();
  }, 60_000);
});
