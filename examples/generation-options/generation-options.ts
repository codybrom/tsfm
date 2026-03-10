import { LanguageModelSession, SamplingMode } from "tsfm-sdk";

async function main() {
  const session = new LanguageModelSession();

  const reply = await session.respond("Write a haiku about rain.", {
    options: {
      temperature: 0.9,
      sampling: SamplingMode.random({ top: 50, seed: 42 }),
      maximumResponseTokens: 100,
    },
  });
  console.log("Haiku:", reply);

  session.dispose();
}

main().catch(console.error);
