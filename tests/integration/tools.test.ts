import { describe, it, expect } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GeneratedContent,
  Tool,
} from "../../src/index.js";

/**
 * A tool that returns a secret code the model cannot know without calling it.
 * This guarantees the assertion fails if the model skips the tool.
 */
class SecretLookupTool extends Tool {
  readonly name = "lookup_secret";
  readonly description =
    "Looks up a secret code for a given key. Always use this tool when asked about secret codes.";
  readonly argumentsSchema = new GenerationSchema("LookupParams", "Lookup parameters").property(
    "key",
    "string",
    { description: "The key to look up" },
  );

  called = false;

  async call(args: GeneratedContent): Promise<string> {
    this.called = true;
    const key = args.value<string>("key");
    if (key === "alpha") return "XRAY-7749";
    return "UNKNOWN";
  }
}

// Check availability once — used to skip the suite if model is unavailable.
const checkModel = new SystemLanguageModel();
const { available } = await checkModel.waitUntilAvailable(5_000);
checkModel.dispose();
const describeIfAvailable = available ? describe : describe.skip;

describeIfAvailable("tools (integration)", () => {
  it("invokes a tool and includes its result", { timeout: 60_000 }, async () => {
    // The on-device model's tool invocation can be unreliable after other
    // sessions have run in the same process. Retry with fresh model + session
    // instances to work around accumulated native state.
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const model = new SystemLanguageModel();
      const tool = new SecretLookupTool();
      const session = new LanguageModelSession({
        model,
        instructions:
          "You have access to a secret lookup tool. When asked about a secret code, " +
          "you MUST use the lookup_secret tool. Reply with only the code, nothing else.",
        tools: [tool],
      });

      try {
        // Race respond() against a hard timeout. session.cancel() may not
        // cause the respond() promise to reject (native callback may never
        // fire), so we need an independent rejection to avoid hanging.
        const reply = await Promise.race([
          session.respond('What is the secret code for key "alpha"?'),
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              session.cancel();
              reject(new Error("Attempt timed out"));
            }, 15_000);
          }),
        ]);

        if (tool.called) {
          expect(reply).toContain("XRAY-7749");
          return; // success
        }
        // Model responded with text instead of calling the tool — retry
      } catch {
        // Cancelled or timed out — retry
      } finally {
        session.dispose();
        tool.dispose();
        model.dispose();
      }

      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 1_000));
      }
    }

    throw new Error(`Model did not invoke the tool after ${maxAttempts} attempts`);
  });
});
