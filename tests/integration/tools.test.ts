import { describe, it, expect } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GeneratedContent,
  Tool,
} from "../../src/index.js";
import { retryAttempts } from "./helpers/retry.js";

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
  calledAt = 0;
  returnedValue = "";

  async call(args: GeneratedContent): Promise<string> {
    this.called = true;
    this.calledAt = Date.now();
    const key = args.value<string>("key");
    this.returnedValue = key === "alpha" ? "XRAY-7749" : "UNKNOWN";
    console.log(
      `[tools test]   tool.call() invoked with key="${key}", returning "${this.returnedValue}"`,
    );
    return this.returnedValue;
  }
}

// Check availability once — used to skip the suite if model is unavailable.
const checkModel = new SystemLanguageModel();
const { available } = await checkModel.waitUntilAvailable(5_000);
checkModel.dispose();
const describeIfAvailable = available ? describe : describe.skip;

describeIfAvailable("tools (integration)", () => {
  it("invokes a tool and includes its result", { timeout: 260_000 }, async () => {
    const { successes } = await retryAttempts(
      async () => {
        const model = new SystemLanguageModel();
        const tool = new SecretLookupTool();
        const session = new LanguageModelSession({
          model,
          instructions:
            "You have access to a lookup_secret tool. You MUST call it when asked about secret codes. " +
            "Do NOT guess or make up codes. Always call the tool first, then reply with only the code.",
          tools: [tool],
        });

        try {
          const { content: reply } = await Promise.race([
            session.respond(
              'Use the lookup_secret tool to find the secret code for key "alpha". ' +
                "Do not guess — call the tool.",
            ),
            // A tool round-trip is two model turns: measured at 4-10s to the
            // tool call and 15-27s to the final reply on a warm device, so a
            // short cap here fails every attempt regardless of correctness.
            new Promise<never>((_, reject) => {
              setTimeout(() => {
                session.cancel();
                reject(new Error("Attempt timed out"));
              }, 30_000);
            }),
          ]);

          if (tool.called && reply.includes("XRAY-7749")) {
            return { success: true, detail: `reply: "${reply.slice(0, 80)}"` };
          }
          return {
            success: false,
            detail: tool.called
              ? `tool called but reply missing code: "${reply.slice(0, 100)}"`
              : `tool not called: "${reply.slice(0, 100)}"`,
          };
        } finally {
          session.dispose();
          tool.dispose();
          model.dispose();
        }
      },
      // The on-device model calls the tool on only about half of attempts, even
      // when told to (measured the same on koffi and Node-API), so 3 attempts
      // failed about 1 run in 8. With 8, a run fails well under 1% of the time
      // unless tool calls are actually broken.
      { maxAttempts: 8, requiredSuccesses: 1, label: "tools test" },
    );

    expect(successes).toBeGreaterThanOrEqual(1);
  });
});
