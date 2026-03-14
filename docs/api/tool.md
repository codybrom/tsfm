# Tool

Abstract base class for defining tools the model can call during generation.

## Abstract Members

Subclasses must implement:

```ts
abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly argumentsSchema: GenerationSchema;
  abstract call(args: GeneratedContent): Promise<string>;
}
```

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique tool identifier |
| `description` | `string` | What the tool does (visible to the model) |
| `argumentsSchema` | `GenerationSchema` | Schema defining the tool's arguments |
| `call(args)` | `async (GeneratedContent) => string` | Handler invoked when the model calls this tool |

## Properties

### `onCall`

Optional callback fired at the start of each tool invocation, before `call()` runs. Receives the tool name and the parsed arguments the model supplied. Useful for logging or showing UI indicators while the model waits for the tool result.

```ts
onCall?: (toolName: string, args: Record<string, unknown>) => void;
```

```ts
const tool = new WeatherTool();
tool.onCall = (name, args) => console.log(`Tool invoked: ${name}`, args);
// Tool invoked: get_weather { city: "Tokyo", units: "celsius" }
```

## Methods

### `dispose()`

Release the native callback. Call after all sessions using this tool are done.

```ts
dispose(): void
```

## Example

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

## Lifecycle

1. Create the tool instance
2. Pass to `LanguageModelSession({ tools: [tool] })`
3. The tool's callback is registered internally when the session is created
4. After all sessions are disposed, call `tool.dispose()`

Tools can be shared across multiple sessions. The native callback remains registered until `dispose()` is called.
