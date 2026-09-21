import { describe, it, expect, afterAll } from "vitest";
import {
  PrivateCloudComputeLanguageModel,
  PrivateCloudComputeUnavailableReason,
  PrivateCloudComputeEntitlementError,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  GeneratedContent,
  Tool,
  Transcript,
  CancelledError,
  UnsupportedCapabilityError,
} from "../../src/index.js";
import Client from "../../src/compat/index.js";
import { retryAttempts } from "./helpers/retry.js";

/** Returns a code the model can't know without calling it (see tools.test.ts). */
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
    return args.value<string>("key") === "alpha" ? "XRAY-7749" : "UNKNOWN";
  }
}

/*
 * Private Cloud Compute needs a host signed with its managed entitlement.
 * Under plain node (the normal integration run) these tests check what users
 * without it see. Under the entitled host from scripts/pcc-host.sh
 * (npm run test:integration:pcc) they run real PCC requests, which count
 * against the signed-in user's daily quota.
 */

const pcc = new PrivateCloudComputeLanguageModel();
// test:integration:pcc sets TSFM_PCC_REQUIRE=1: then PCC must become available, so
// an ineligible or not-ready machine fails the run instead of skipping every test.
const required = process.env.TSFM_PCC_REQUIRE === "1";
const availability = required ? await pcc.waitUntilAvailable(60_000) : pcc.isAvailable();
afterAll(() => pcc.dispose());

describe.runIf(required)("Private Cloud Compute is required (test:integration:pcc)", () => {
  it("is available on this host", () => {
    expect(
      availability,
      "PCC isn't available here, so the entitled tests can't run. Check the entitlement, " +
        "the device's eligibility and that Apple Intelligence is set up.",
    ).toEqual({ available: true });
  });
});

const entitled = availability.available;
const describeWithoutEntitlement =
  availability.reason === PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING
    ? describe
    : describe.skip;
const describeEntitled = entitled ? describe : describe.skip;

describeWithoutEntitlement("Private Cloud Compute without the entitlement (integration)", () => {
  it("reports the missing entitlement instead of claiming availability", () => {
    expect(availability).toEqual({
      available: false,
      reason: PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING,
    });
  });

  it("fails requests with PrivateCloudComputeEntitlementError", async () => {
    const session = new LanguageModelSession({ model: pcc });
    await expect(session.respond("Say hi.")).rejects.toBeInstanceOf(
      PrivateCloudComputeEntitlementError,
    );
    session.dispose();
  }, 30_000);

  it("fails compat requests for the PCC model with an HTTP status", async () => {
    using client = new Client();
    // The compat layer speaks HTTP: a proxy built on it needs a status, not a
    // raw SDK error it would report as 500. A missing entitlement is a
    // configuration problem, so 403 rather than a retryable code.
    await expect(
      client.chat.completions.create({
        model: "PrivateCloudComputeLanguageModel",
        messages: [{ role: "user", content: "Say hi." }],
      }),
    ).rejects.toMatchObject({ name: "CompatError", status: 403 });
  }, 30_000);

  it("still reads the context size", async () => {
    expect(await pcc.contextSize()).toBe(32768);
  }, 30_000);
});

describe("reasoningLevel on the on-device model (integration)", () => {
  it("is rejected before the request", async () => {
    const session = new LanguageModelSession();
    await expect(
      session.respond("Say hi.", { options: { reasoningLevel: "deep" } }),
    ).rejects.toBeInstanceOf(UnsupportedCapabilityError);
    session.dispose();
  });
});

describeEntitled("Private Cloud Compute (entitled host)", () => {
  it("responds, with usage", async () => {
    const session = new LanguageModelSession({ model: pcc });
    const { content, usage } = await session.respond("Say hi in five words.");
    expect(content.length).toBeGreaterThan(0);
    expect(usage?.input.totalTokens).toBeGreaterThan(0);
    expect(usage?.output.totalTokens).toBeGreaterThan(0);
    session.dispose();
  }, 60_000);

  it("accepts a reasoning level", async () => {
    const session = new LanguageModelSession({ model: pcc });
    const { content } = await session.respond(
      "A bat and a ball cost $1.10; the bat costs $1 more than the ball. What does the ball cost? One line.",
      { options: { reasoningLevel: "moderate" } },
    );
    expect(content).toMatch(/0?\.05|5 cents/);
    session.dispose();
  }, 60_000);

  it("allows regex character classes, unlike the on-device model", async () => {
    const schema = new GenerationSchema("Code", "A code").property("value", "string", {
      guides: [GenerationGuide.regex("[A-Z]{3}-[0-9]{2}")],
    });
    const session = new LanguageModelSession({ model: pcc });
    const { content } = await session.respondWithSchema("Make one up.", schema);
    expect(content.value<string>("value")).toMatch(/^[A-Z]{3}-[0-9]{2}$/);
    session.dispose();
  }, 60_000);

  it("streams, with usage", async () => {
    const session = new LanguageModelSession({ model: pcc });
    const response = await session.streamResponse("Count from 1 to 3.").collect();
    expect(response.content.length).toBeGreaterThan(0);
    expect(response.usage?.output.totalTokens).toBeGreaterThan(0);
    session.dispose();
  }, 60_000);

  it("serves compat requests, mapping reasoning_effort", async () => {
    using client = new Client();
    const completion = await client.chat.completions.create({
      model: "PrivateCloudComputeLanguageModel",
      reasoning_effort: "low",
      messages: [{ role: "user", content: "What is 6 times 7? Just the number." }],
    });
    expect(completion.model).toBe("PrivateCloudComputeLanguageModel");
    expect(completion.choices[0].message.content).toContain("42");
    expect(completion.usage?.completion_tokens).toBeGreaterThan(0);
  }, 60_000);

  it("invokes a tool and includes its result", { timeout: 260_000 }, async () => {
    const { successes } = await retryAttempts(
      async () => {
        const tool = new SecretLookupTool();
        const session = new LanguageModelSession({
          model: pcc,
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
              { options: { maximumResponseTokens: 60 } },
            ),
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
        }
      },
      // Fewer attempts than tools.test.ts: each one counts against the daily quota.
      { maxAttempts: 4, requiredSuccesses: 1, label: "pcc tools test" },
    );
    expect(successes).toBeGreaterThanOrEqual(1);
  });

  it("generates content matching a GenerationSchema", async () => {
    const schema = new GenerationSchema("Color", "A color")
      .property("name", "string", { guides: [GenerationGuide.anyOf(["red", "blue", "green"])] })
      .property("isPrimary", "boolean", { description: "Whether this is a primary color" });
    const session = new LanguageModelSession({ model: pcc });
    const { content, usage } = await session.respondWithSchema("Pick a color.", schema);
    expect(["red", "blue", "green"]).toContain(content.value<string>("name"));
    expect(typeof content.value<boolean>("isPrimary")).toBe("boolean");
    expect(usage?.output.totalTokens).toBeGreaterThan(0);
    session.dispose();
  }, 60_000);

  it("generates content from a JSON schema", async () => {
    const session = new LanguageModelSession({ model: pcc });
    // Titled explicitly: untitled inline objects all become "Object" in
    // afmSchemaFormat(), and the framework then gives them one shape.
    const { content } = await session.respondWithJsonSchema("Make up a person and their pet.", {
      type: "object",
      properties: {
        owner: { type: "object", title: "Owner", properties: { name: { type: "string" } } },
        pet: {
          type: "object",
          title: "Pet",
          properties: { species: { type: "string" }, legs: { type: "integer" } },
        },
      },
    });
    const value = content.toObject() as {
      owner: { name: string };
      pet: { species: string; legs: number };
    };
    expect(typeof value.owner.name).toBe("string");
    expect(typeof value.pet.species).toBe("string");
    expect(Number.isInteger(value.pet.legs)).toBe(true);
    session.dispose();
  }, 60_000);

  it("keeps context across turns", async () => {
    const session = new LanguageModelSession({ model: pcc });
    // A benign fact: a "password" trips PCC's guardrail.
    await session.respond("My cat is called Pumpernickel. Reply with just OK.", {
      options: { maximumResponseTokens: 20 },
    });
    const { content } = await session.respond("What is my cat called? Reply with just the name.", {
      options: { maximumResponseTokens: 20 },
    });
    expect(content).toContain("Pumpernickel");
    expect(session.transcript.toJson()).toContain("Pumpernickel");
    session.dispose();
  }, 90_000);

  it("resumes a transcript on PCC and sees the earlier turn", async () => {
    const first = new LanguageModelSession({ model: pcc });
    await first.respond("My name is Zephyrina. Reply with just OK.", {
      options: { maximumResponseTokens: 20 },
    });
    const json = first.transcript.toJson();
    first.dispose();

    const resumed = LanguageModelSession.fromTranscript(Transcript.fromJson(json), { model: pcc });
    const { content, usage } = await resumed.respond("What is my name? Reply with just the name.", {
      options: { maximumResponseTokens: 20 },
    });
    expect(content).toContain("Zephyrina");
    expect(usage?.input.totalTokens).toBeGreaterThan(0);
    resumed.dispose();
  }, 90_000);

  it("rejects a cancelled request with CancelledError", async () => {
    const session = new LanguageModelSession({ model: pcc });
    const pending = session.respond("Write a 600-word story about a lighthouse keeper.", {
      options: { maximumResponseTokens: 200 },
    });
    setTimeout(() => session.cancel(), 400);
    // The model can beat the cancel; only the rejection shape is under test.
    await pending.then(
      () => undefined,
      (err: unknown) => {
        expect(err).toBeInstanceOf(CancelledError);
        expect((err as Error).message).toContain("cancelled");
      },
    );
    // The session is still usable afterwards.
    const { content } = await session.respond("Say hi in one word.", {
      options: { maximumResponseTokens: 10 },
    });
    expect(content.length).toBeGreaterThan(0);
    session.dispose();
  }, 60_000);

  it("reports a coherent quota", () => {
    const quota = pcc.quotaUsage;
    expect(quota).not.toBeNull();
    expect(typeof quota?.limitReached).toBe("boolean");
    expect(typeof quota?.approachingLimit).toBe("boolean");
    // These requests just ran, so the limit can't have been reached.
    expect(quota?.limitReached).toBe(false);
    if (quota?.resetDate !== null) {
      expect(quota?.resetDate).toBeInstanceOf(Date);
      expect(Number.isNaN(quota?.resetDate.getTime())).toBe(false);
    }
  });
});
