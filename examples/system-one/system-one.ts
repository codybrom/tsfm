import { SystemOneClient, choice, noul, score } from "tsfm-sdk/system1";

async function main() {
  using client = new SystemOneClient();
  const { available, reason } = await client.model.waitUntilAvailable();
  if (!available) {
    console.error("On-device model unavailable:", reason);
    return;
  }

  const { answers } = await client.systemOne({
    state: {
      ticket: "I was charged twice and need the duplicate payment refunded today.",
    },
    questions: {
      department: choice("Which team should handle `ticket`?", {
        billing: "Payments, charges, and refunds",
        technical: "Product bugs and outages",
        sales: "Pricing and upgrades",
        other: "None of the other options fit",
      }),
      urgent: noul("Does `ticket` explicitly communicate time pressure?"),
      frustration: score("How frustrated does the customer in `ticket` appear?", [
        "Calm and neutral",
        "Concerned but civil",
        "Very angry or using strong language",
      ]),
    },
  });

  const route = answers.department;
  if (route.confidence < 0.35) {
    console.log("Route to human review", route.probabilities);
  } else {
    console.log("Route to", route.choice, route.probabilities);
  }

  console.log("Urgency P(true):", answers.urgent.noul);
  console.log("Frustration score:", answers.frustration.score);
}

main().catch(console.error);
