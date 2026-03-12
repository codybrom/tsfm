# Tools

Tools let the model call your functions during generation. It is up to the model to decide if a tool can help, generate arguments matching your schema, call the tool, receive the result and continue generating.

::: info
The **Swift** equivalent is the Foundation Models [`Tool`](https://developer.apple.com/documentation/foundationmodels/tool) protocol.
:::

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

## Best Practices

The Foundation Model [`Tool` documentation](https://developer.apple.com/documentation/foundationmodels/tool) recommends:

- **Limit to 3–5 tools per session.** Tool schemas and descriptions consume context window space. More tools means less room for conversation. If your session exceeds the context size, split work across new sessions.
- **Keep descriptions short.** A brief phrase is enough. Long descriptions add latency and use up context.
- **Pre-run essential tools.** If a tool's output is always needed, call it yourself and include the result in the prompt or instructions rather than waiting for the model to discover it needs the tool.

## Tool Chaining

The model can call multiple tools in sequence within a single `respond()` call. If the first tool's output informs a second tool call, the model handles the chaining automatically — you don't need to loop.

## Chat API Tool Calling

If you prefer the Chat API tool calling interface, the [compatibility layer](/guide/chat-api#tool-calling) supports `tools` with the standard `ChatCompletionTool` format. You define tools as JSON objects instead of extending the `Tool` class, and handle tool execution yourself between requests.
