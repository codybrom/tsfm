import {
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  GeneratedContent,
  Tool,
} from "tsfm-sdk";

class CalculatorTool extends Tool {
  readonly name = "calculator";
  readonly description = "Performs basic arithmetic. Returns the result as a number.";

  readonly argumentsSchema = new GenerationSchema("CalculatorParams", "Calculator inputs")
    .property("operation", "string", {
      description: "One of: add, subtract, multiply, divide",
      guides: [GenerationGuide.anyOf(["add", "subtract", "multiply", "divide"])],
    })
    .property("a", "number", { description: "First operand" })
    .property("b", "number", { description: "Second operand" });

  async call(args: GeneratedContent): Promise<string> {
    const op = args.value<string>("operation");
    const a = args.value<number>("a");
    const b = args.value<number>("b");

    switch (op) {
      case "add":
        return String(a + b);
      case "subtract":
        return String(a - b);
      case "multiply":
        return String(a * b);
      case "divide":
        if (b === 0) throw new Error("Division by zero");
        return String(a / b);
      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  }
}

async function main() {
  const calculator = new CalculatorTool();
  const session = new LanguageModelSession({
    instructions: "You are a helpful math assistant.",
    tools: [calculator],
  });

  const reply = await session.respond("What is 15% of 240?");
  console.log("Answer:", reply);

  session.dispose();
  calculator.dispose();
}

main().catch(console.error);
