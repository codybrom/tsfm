import { LanguageModelSession } from "tsfm-sdk";

async function main() {
  const session = new LanguageModelSession();

  process.stdout.write("Streaming: ");
  for await (const chunk of session.streamResponse("Tell me a joke in one sentence.")) {
    process.stdout.write(chunk);
  }
  console.log();

  session.dispose();
}

main().catch(console.error);
