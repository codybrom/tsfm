import { LanguageModelSession, GenerationSchema, GenerationGuide } from "tsfm-sdk";

async function main() {
  const personSchema = new GenerationSchema("Person", "A person profile")
    .property("name", "string", { description: "Full name" })
    .property("age", "integer", {
      description: "Age in years",
      guides: [GenerationGuide.range(0, 120)],
    })
    .property("occupation", "string", { description: "Job title" });

  const session = new LanguageModelSession();
  const content = await session.respondWithJsonSchema(
    "Generate a person profile",
    personSchema.toDict(),
  );
  console.log("Person:", content.toObject());

  session.dispose();
}

main().catch(console.error);
