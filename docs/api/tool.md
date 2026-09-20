# Tool

Abstract base class for defining tools the model can call during generation.

## Abstract Members

Subclasses must implement:

```ts
abstract class Tool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly argumentsSchema: GenerationSchema;
  abstract call(args: GeneratedContent, context: ToolCallContext): Promise<string>;
}
```

| Member | Type | Description |
| --- | --- | --- |
| `name` | `string` | Unique tool identifier |
| `description` | `string` | What the tool does (visible to the model) |
| `argumentsSchema` | `GenerationSchema` | Schema defining the tool's arguments |
| `call(args, context)` | `(GeneratedContent, ToolCallContext) => Promise<string>` | Handler invoked when the model calls this tool. `args` is released once `call()` settles, so read what you need from it before then. |

## Cancellation

`ToolCallContext` is exported from `tsfm-sdk`:

```ts
interface ToolCallContext {
  readonly signal: AbortSignal;
}
```

Each invocation gets its own signal. Request cancellation (including stopping
a stream early) aborts that invocation's signal. `tool.dispose()` aborts every
pending invocation of that tool. Cancelling one session does not abort calls
from another session sharing the same tool. Notifications arrive asynchronously
from the native request.

Pass the signal to cancellable APIs such as `fetch()`, or check
`signal.throwIfAborted()` between steps. Cancellation cannot forcibly interrupt
JavaScript or undo side effects. Tools that ignore the signal may keep running,
but their late results are ignored. Existing `call(args)` implementations remain
valid. Arguments remain available until `call()` settles, even after cancellation.

See [Cancellable tools](/guide/tools#cancellable-tools) for an example.

## Failing the request

If `call()` throws, the error's message goes back to the model as the tool's
output and generation continues. To fail the whole request instead, throw
`FailRequestError`:

```ts
import { Tool, FailRequestError, RequestFailedByToolError } from "tsfm-sdk";

class Lookup extends Tool {
  // ...
  async call(args: GeneratedContent): Promise<string> {
    const row = await db.find(args.value<string>("id"));
    if (!row) throw new FailRequestError("No such record", { cause: notFound });
    return row.summary;
  }
}

try {
  await session.respond("Look up record 42", { options: { toolCallingMode: "required" } });
} catch (err) {
  if (err instanceof RequestFailedByToolError) {
    err.toolName; // "lookup"
    err.cause; // the FailRequestError
  }
}
```

The call is answered once, by failing it, and `respond()` (or the stream)
rejects with `RequestFailedByToolError`. With `toolCallingMode: "required"`,
this is how a tool ends the request, as Apple documents for a throwing
`call(arguments:)`.

This works whether `call()` throws synchronously or returns a rejected Promise.
When concurrent sessions share a tool, each failed request receives its own
invocation's original `FailRequestError` as `cause`, even when the messages match.

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
