import { SystemLanguageModel, SystemLanguageModelUseCase, LanguageModelSession } from "tsfm-sdk";

async function main() {
  const model = new SystemLanguageModel({
    useCase: SystemLanguageModelUseCase.CONTENT_TAGGING,
  });

  const { available } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Content tagging model not available");
    model.dispose();
    return;
  }

  const session = new LanguageModelSession({ model });
  const reply = await session.respond("Classify this text: 'I love pizza!'");
  console.log("Tag:", reply);

  session.dispose();
  model.dispose();
}

main().catch(console.error);
