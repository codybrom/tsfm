# Structured Output

When you provide a schema, the on-device model uses constrained sampling to guarantee its output matches your types and structure with no string parsing needed.

::: info
The **Swift** equivalents are the [`@Generable`](https://developer.apple.com/documentation/foundationmodels/generable) macro for compile-time schemas and [`DynamicGenerationSchema`](https://developer.apple.com/documentation/foundationmodels/dynamicgenerationschema) for runtime schemas. TSFM's `GenerationSchema` maps to the same underlying dictionary format.
:::

If you already have or prefer to use JSON Schema objects, you can use `respondWithJsonSchema` instead and the SDK will convert it at runtime.

If you're unsure which schema format you should use, see [Picking a Schema Format](#picking-a-schema-format).

## Defining a Schema (Native Format)

```ts
import { GenerationSchema, GenerationGuide } from "tsfm-sdk";

const schema = new GenerationSchema("Person", "A person profile")
  .property("name", "string", { description: "Full name" })
  .property("age", "integer", {
    description: "Age in years",
    guides: [GenerationGuide.range(0, 120)],
  })
  .property("tags", "array", {
    guides: [GenerationGuide.maxItems(5)],
    optional: true,
  });
```

### Property Types

`"string"` | `"integer"` | `"number"` | `"boolean"` | `"array"` | `"object"`

## Generation Guides

Guides constrain the model's output for a property.

::: info
The **Swift** equivalent is Foundation Models' [`@Guide`](https://developer.apple.com/documentation/foundationmodels/guide()) annotations. See Apple's [Generating Swift Data Structures with Guided Generation](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation) guide.
:::

| Method | Constrains |
| --- | --- |
| `GenerationGuide.anyOf(["a", "b"])` | Enumerated string values |
| `GenerationGuide.constant("fixed")` | Exact string value |
| `GenerationGuide.range(min, max)` | Numeric range (inclusive) |
| `GenerationGuide.minimum(n)` | Numeric lower bound |
| `GenerationGuide.maximum(n)` | Numeric upper bound |
| `GenerationGuide.regex(pattern)` | String pattern |
| `GenerationGuide.count(n)` | Exact array length |
| `GenerationGuide.minItems(n)` | Minimum array length |
| `GenerationGuide.maxItems(n)` | Maximum array length |
| `GenerationGuide.element(guide)` | Applies a guide to array elements |

## Generating Structured Output

```ts
const session = new LanguageModelSession();
const content = await session.respondWithSchema("Describe a software engineer", schema);
```

### Extracting Values

Use `content.value<T>(key)` to extract typed values:

```ts
const name = content.value<string>("name");
const age = content.value<number>("age");
```

### Full Example

```ts
interface Cat {
  name: string;
  age: number;
  breed: string;
}

const schema = new GenerationSchema("Cat", "A rescue cat")
  .property("name", "string", { description: "The cat's name" })
  .property("age", "integer", {
    description: "Age in years",
    guides: [GenerationGuide.range(0, 20)],
  })
  .property("breed", "string", { description: "The cat's breed" });

const content = await session.respondWithSchema("Generate a rescue cat", schema);

const cat: Cat = {
  name: content.value("name"),
  age: content.value("age"),
  breed: content.value("breed"),
};
```

## Generating Structured Output with JSON Schema

If you already have a JSON Schema definition, or are porting from OpenAI or another API, you can pass it directly with respondWithJsonSchema instead of building a GenerationSchema first:

```ts
const content = await session.respondWithJsonSchema("Generate a person profile", {
  type: "object",
  properties: {
    name: { type: "string", description: "Full name" },
    age: { type: "integer", description: "Age in years" },
    occupation: { type: "string", description: "Job title" },
  },
  required: ["name", "age", "occupation"],
});

const person = content.toObject();
// { name: "Ada Lovelace", age: 36, occupation: "Mathematician" }
```

The SDK converts JSON Schema to Apple's native format automatically. Use toObject to get the full result as a plain object instead of extracting properties individually.

## Picking a Schema Format

Both methods are capable of producing constrained output. The choice comes down to whether you need [generation guides](#generation-guides) and what format you already have.

Use **`respondWithSchema`** when you need the extra constraints possible only with generation guides. It takes a `GenerationSchema` built with TSFM, which is the native [dictionary](https://developer.apple.com/documentation/swift/dictionary) format that Foundation Models uses internally. This option is also the only path that supports [generation guides](#generation-guides). Guides like `constant`, `anyOf`, and `element` have no JSON Schema equivalent. Generation guides allow you to constrain token selection at generation time rather than validating output after.

Use **`respondWithJsonSchema`** when you already have existing JSON schemas or don't need the extra constraints possible with generation guides. It accepts a standard JSON Schema object and TSFM converts it to the model's dictionary format at runtime. Standard constraints like `enum`, `minimum`/`maximum`, and `pattern` all work, but the model's more specific generation guides aren't available if you pass a JSON Schema.

If you don't need guides, either works. If you already have JSON schemas or are porting from another API, `respondWithJsonSchema` is the faster path.

::: tip
The [Chat API compatibility layer](/guide/chat-api#structured-output) also supports structured output via `response_format: { type: "json_schema" }`, using the same JSON Schema format as the Chat Completions API.
:::
