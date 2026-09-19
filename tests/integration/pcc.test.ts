import { describe, it, expect, afterAll } from "vitest";
import {
  PrivateCloudComputeLanguageModel,
  PrivateCloudComputeUnavailableReason,
  PrivateCloudComputeEntitlementError,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  UnsupportedCapabilityError,
} from "../../src/index.js";

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
    expect(usage.input.totalTokens).toBeGreaterThan(0);
    expect(usage.output.totalTokens).toBeGreaterThan(0);
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
    expect(response.usage.output.totalTokens).toBeGreaterThan(0);
    session.dispose();
  }, 60_000);

  it("reports the quota", () => {
    const quota = pcc.quotaUsage;
    expect(typeof quota.limitReached).toBe("boolean");
    expect(typeof quota.approachingLimit).toBe("boolean");
  });
});
