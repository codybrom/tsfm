# Tools

Tools let the model call your functions during generation. This maps directly to Foundation Models' [`Tool`](https://developer.apple.com/documentation/foundationmodels/tool) protocol — same concept, same flow: the model decides a tool can help, generates arguments matching your schema, calls the tool, receives the result, and continues generating.

## Defining a Tool

Extend the abstract `Tool` class:

```ts
import { Tool, GenerationSchema, GeneratedContent, GenerationGuide } from "tsfm-sdk";

class WeatherTool extends Tool {
  readonly name = "get_weather";
  readonly description = "Gets current weather for a city.";

  readonly argumentsSchema = new GenerationSchema("WeatherParams", "")
    .property("city", "string", { description: "City name" })
    .property("units", "string", {
      description: "Temperature units",
      guides: [GenerationGuide.anyOf(["celsius", "fahrenheit"])],
    });

  async call(args: GeneratedContent): Promise<string> {
    const city = args.value<string>("city");
    const units = args.value<string>("units");
    return `Sunny, 22°C in ${city} (${units})`;
  }
}
```

### Required Members

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique tool identifier |
| `description` | `string` | What the tool does (shown to the model) |
| `argumentsSchema` | `GenerationSchema` | Schema for the tool's arguments |
| `call(args)` | `async (GeneratedContent) => string` | Handler that returns a string result |

## Using Tools in a Session

Pass tools when creating a session:

```ts
const tool = new WeatherTool();
const session = new LanguageModelSession({
  instructions: "You are a helpful assistant.",
  tools: [tool],
});

const reply = await session.respond("What's the weather in Tokyo?");
// The model calls get_weather, receives the result, and formulates a response
```

## Error Handling

If `call()` throws, it's wrapped in a `ToolCallError`:

```ts
try {
  await session.respond("...");
} catch (e) {
  if (e instanceof ToolCallError) {
    console.log(e.message); // includes tool name and original error
  }
}
```

## Cleanup

Tools register a native callback that must be released:

```ts
session.dispose();
tool.dispose();
```

Tools can be reused across sessions — just dispose after all sessions are done.

## Tool Chaining

The model can call multiple tools in sequence within a single `respond()` call. If the first tool's output informs a second tool call, the model handles the chaining automatically — you don't need to loop.
