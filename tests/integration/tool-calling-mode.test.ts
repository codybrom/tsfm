import { describe, it, expect, afterAll } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GeneratedContent,
  Tool,
  ToolCallLimitExceededError,
} from "../../src/index.js";

class WeatherTool extends Tool {
  readonly name = "get_weather";
  readonly description = "Gets the current weather for a city.";
  readonly argumentsSchema = new GenerationSchema("WeatherArgs", "Weather lookup").property(
    "city",
    "string",
    { description: "City name" },
  );
  calls = 0;

  async call(args: GeneratedContent): Promise<string> {
    this.calls++;
    return `${args.value<string>("city")}: 18C and sunny`;
  }
}

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

describeIfAvailable("tool calling modes (integration)", () => {
  // toolCallingMode "required" makes the model call tools again and again (Apple
  // documents that it needs an exit condition). Without tsfm's limit this
  // request would never end.
  it("stops a 'required' loop at maximumToolCalls", async () => {
    const tool = new WeatherTool();
    const session = new LanguageModelSession({ tools: [tool] });
    const error = await session
      .respond("What's the weather in Paris?", {
        options: { toolCallingMode: "required", maximumToolCalls: 3 },
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(ToolCallLimitExceededError);
    expect((error as Error).message).toMatch(/limit of 3 tool calls/);
    expect(tool.calls).toBe(3);

    // The session still works, and the next request gets a fresh budget.
    const { content } = await session.respond("Say hi.", {
      options: { toolCallingMode: "disallowed" },
    });
    expect(content.length).toBeGreaterThan(0);
    session.dispose();
    tool.dispose();
  }, 90_000);

  it("stops a streamed 'required' loop at maximumToolCalls", async () => {
    const tool = new WeatherTool();
    const session = new LanguageModelSession({ tools: [tool] });
    const drain = async () => {
      for await (const _delta of session.streamResponse("Weather in Tokyo?", {
        options: { toolCallingMode: "required", maximumToolCalls: 2 },
      })) {
        // Draining until the stream throws.
      }
    };
    await expect(drain()).rejects.toBeInstanceOf(ToolCallLimitExceededError);
    expect(tool.calls).toBe(2);
    session.dispose();
    tool.dispose();
  }, 90_000);

  it("never calls a tool with 'disallowed'", async () => {
    const tool = new WeatherTool();
    const session = new LanguageModelSession({ tools: [tool] });
    const { content } = await session.respond("Use the tool to get the weather in Paris.", {
      options: { toolCallingMode: "disallowed" },
    });
    expect(content.length).toBeGreaterThan(0);
    expect(tool.calls).toBe(0);
    session.dispose();
    tool.dispose();
  }, 60_000);

  it("maximumToolCalls: 0 refuses the first tool call", async () => {
    const tool = new WeatherTool();
    const session = new LanguageModelSession({ tools: [tool] });
    await expect(
      session.respond("What's the weather in Paris?", {
        options: { toolCallingMode: "required", maximumToolCalls: 0 },
      }),
    ).rejects.toBeInstanceOf(ToolCallLimitExceededError);
    expect(tool.calls).toBe(0);
    session.dispose();
    tool.dispose();
  }, 60_000);
});
