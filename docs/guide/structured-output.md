# Structured Output

When you provide a schema, the on-device model uses constrained sampling to guarantee its output matches your types and structure with no string parsing needed.

In Swift, Foundation Models offers `@Generable` for compile-time schemas and [`DynamicGenerationSchema`](https://developer.apple.com/documentation/foundationmodels/dynamicgenerationschema) for runtime schemas. This SDK's `GenerationSchema` builder maps to the same underlying dictionary format that both use, with the ability to set [generation guides](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation).

If you already have or prefer to use JSON Schema objects, you can use `respondWithJsonSchema` instead and the SDK will convert it at runtime.

If you're unsure which schema format you should use, see [GenerationSchema vs JSON Schema](#generationschema-vs-json-schema).

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

Guides constrain the model's output for a property. These map to Foundation Models' [`@Guide`](https://developer.apple.com/documentation/foundationmodels/guide()) annotations:

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

## GenerationSchema vs JSON Schema

Both methods produce the same constrained output. The difference is the schema format and what constraints are available.

- **respondWithSchema** takes a GenerationSchema built with the SDK's builder API. This is the native [dictionary](https://developer.apple.com/documentation/swift/dictionary) format that Foundation Models uses internally, and it's the only path that supports [generation guides](#generation-guides). Guides like `constant`, `anyOf`, and `element` have no JSON Schema equivalent. They constrain token selection at generation time rather than validating output after.

  - Use this when you need the extra constraints possible only with generation guides

- **respondWithJsonSchema** takes a standard JSON Schema object. The SDK converts it to the model's dictionary format at runtime. Standard constraints like `enum`, `minimum`/`maximum`, and `pattern` all work, but the model's more specific generation guides aren't available if you pass a JSON Schema.
  - Use this when you already have existing JSON schemas or don't need the extra constraints possible with generation guides.
