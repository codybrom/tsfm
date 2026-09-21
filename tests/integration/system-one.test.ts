import { afterAll, describe, expect, it } from "vitest";
import { SystemLanguageModel } from "../../src/index.js";
import { SystemOneClient, choice, noul, score } from "../../src/system-one.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

describeIfAvailable("System One decisions (integration)", () => {
  it("returns bounded typed decisions for shared state", async () => {
    const client = new SystemOneClient({ model });
    const result = await client.systemOne({
      state: { ticket: "I was charged twice and need a refund today." },
      questions: {
        department: choice("Which team should handle this?", {
          billing: "Payments and refunds",
          technical: "Bugs and outages",
          sales: "Pricing and upgrades",
        }),
        urgent: noul("Does this request communicate urgency?"),
        frustration: score("How frustrated is the customer?", ["Calm", "Concerned", "Angry"]),
      },
    });

    expect(["billing", "technical", "sales"]).toContain(result.answers.department.choice);
    expect(
      Object.values(result.answers.department.probabilities).reduce((a, b) => a + b, 0),
    ).toBeCloseTo(1);
    expect(result.answers.department.confidence).toBeGreaterThanOrEqual(0);
    expect(result.answers.department.confidence).toBeLessThanOrEqual(1);
    expect(result.answers.urgent.noul).toBeGreaterThanOrEqual(0);
    expect(result.answers.urgent.noul).toBeLessThanOrEqual(1);
    expect(result.answers.frustration.score).toBeGreaterThanOrEqual(0);
    expect(result.answers.frustration.score).toBeLessThanOrEqual(2);
    client.dispose();
  }, 60_000);
});
