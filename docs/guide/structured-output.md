# Structured Output

When you provide a schema, the on-device model constrains its output to match your types and structure.

There are two ways to define schemas. The `GenerationSchema` builder uses the same [dictionary](https://developer.apple.com/documentation/swift/dictionary) object that Foundation Models [use natively](https://developer.apple.com/documentation/foundationmodels/generating-swift-data-structures-with-guided-generation) with the ability to set generation guides. If you already have JSON Schema objects, you can use `respondWithJsonSchema` instead and the SDK will convert it at runtime to the model's preferred format.

If you're unsure which one to use, see [GenerationSchema vs JSON Schema](#generationschema-vs-json-schema).

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

The two methods produce the same constrained output — the difference is how you define the schema:

- **respondWithSchema** accepts a GenerationSchema in Apple's native [dictionary](https://developer.apple.com/documentation/swift/dictionary) format. This is what Foundation Models uses natively. It also gives you access to generation guides (range, anyOf, regex, count, etc.) that aren't expressible in standard JSON Schema and per-property access via `content.value<T>(key)`.
- **respondWithJsonSchema** accepts a plain JSON Schema object. The SDK converts it to a dictionary under the hood, but generation guides aren't available through this path. Use this method when you already have JSON Schemas or are porting from another API and don't need fine-grained constraints.
