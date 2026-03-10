import { LanguageModelSession, GenerationSchema, GenerationGuide } from "tsfm-sdk";

interface Cat {
  name: string;
  age: number;
  breed: string;
}

async function main() {
  const schema = new GenerationSchema("Cat", "A rescue cat")
    .property("name", "string", { description: "The cat's name" })
    .property("age", "integer", {
      description: "Age in years",
      guides: [GenerationGuide.range(0, 20)],
    })
    .property("breed", "string", { description: "The cat's breed" });

  const session = new LanguageModelSession();
  const content = await session.respondWithSchema("Generate a rescue cat", schema);

  const cat: Cat = {
    name: content.value("name"),
    age: content.value("age"),
    breed: content.value("breed"),
  };
  console.log("Cat:", cat);

  session.dispose();
}

main().catch(console.error);
