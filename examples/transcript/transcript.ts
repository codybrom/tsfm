import { LanguageModelSession, Transcript } from "tsfm-sdk";

async function main() {
  // First session — establish context
  const session = new LanguageModelSession();
  await session.respond("My name is Cody.");
  await session.respond("What is my name?");

  // Export transcript
  const json = session.transcript.toJson();
  console.log("Transcript (first 100 chars):", json.slice(0, 100));

  // Resume from saved transcript
  const savedTranscript = Transcript.fromJson(json);
  const resumed = LanguageModelSession.fromTranscript(savedTranscript);
  const recall = await resumed.respond("Summarize our conversation so far.");
  console.log("Recalled:", recall);

  session.dispose();
  resumed.dispose();
}

main().catch(console.error);
