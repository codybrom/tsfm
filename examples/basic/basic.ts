import { SystemLanguageModel, LanguageModelSession } from "tsfm-sdk";

async function main() {
  const model = new SystemLanguageModel();
  const { available, reason } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Model not available:", reason);
    model.dispose();
    return;
  }

  const session = new LanguageModelSession({
    instructions: "You are a concise assistant.",
  });

  const reply = await session.respond("What is the capital of France?");
  console.log("Response:", reply);

  session.dispose();
  model.dispose();
}

main().catch(console.error);
