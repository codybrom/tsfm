import { afterAll, describe, expect, it } from "vitest";
import {
  FailRequestError,
  GenerationSchema,
  LanguageModelSession,
  RequestFailedByToolError,
  SystemLanguageModel,
  Tool,
} from "../../src/index.js";
import { hasMacOS27 } from "../../src/os.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
afterAll(() => model.dispose());

describe.runIf(available && hasMacOS27())("tool failure messages across the native bridge", () => {
  it.each(["text", "schema", "json", "stream"] as const)(
    "preserves a synchronous FailRequestError from a %s request",
    async (kind) => {
      class FailingTool extends Tool {
        name = "lookup_secret";
        description = "Look up the secret code.";
        argumentsSchema = new GenerationSchema("Lookup").property("key", "string");
        failure = new FailRequestError('No record "alpha"\nTry again', { cause: new Error("404") });
        call(): Promise<string> {
          throw this.failure;
        }
      }
      using tool = new FailingTool();
      using session = new LanguageModelSession({ model, tools: [tool] });
      const options = { options: { toolCallingMode: "required" as const } };
      const prompt = "Look up the secret code for alpha.";
      const schema = new GenerationSchema("Result").property("code", "string");
      const run = () => {
        switch (kind) {
          case "text":
            return session.respond(prompt, options);
          case "schema":
            return session.respondWithSchema(prompt, schema, options);
          case "json":
            return session.respondWithJsonSchema(prompt, schema.toDict(), options);
          case "stream":
            return session.streamResponse(prompt, options).collect();
        }
      };
      const error = await run().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RequestFailedByToolError);
      expect((error as RequestFailedByToolError).cause).toBe(tool.failure);
      expect((error as Error).message).toBe(
        `Tool 'lookup_secret' failed the request: ${tool.failure.message}`,
      );
    },
    60_000,
  );
});
