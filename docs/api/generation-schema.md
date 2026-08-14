# GenerationSchema

Builder for typed schemas that constrain structured generation output.

## Constructor

```ts
new GenerationSchema(name: string, description: string)
```

## Methods

### `property()`

Add a property to the schema. Returns `this` for chaining.

```ts
property(name: string, type: PropertyType | `array<${string}>`, options?: {
  description?: string;
  guides?: GenerationGuide[];
  optional?: boolean;
}): this
```

::: warning
Bare `"array"` is not accepted — use a compound form like `"array<string>"` or `"array<integer>"`. For object arrays, use `generable()` which resolves types automatically.
:::

### `toDict()`

Export the schema as a JSON Schema-compatible dictionary.

```ts
toDict(): object
```

## Types

### `PropertyType`

```ts
type PropertyType = "string" | "integer" | "number" | "boolean" | "array" | "object"
```

## GenerationGuide

Factory methods that create output constraints for schema properties.

### String Guides

```ts
GenerationGuide.anyOf(values: string[])    // enumerated values
GenerationGuide.constant(value: string)     // exact value
GenerationGuide.regex(pattern: string)      // regex pattern
```

### Numeric Guides

```ts
GenerationGuide.range(min: number, max: number)  // inclusive range
GenerationGuide.minimum(n: number)                // lower bound
GenerationGuide.maximum(n: number)                // upper bound
```

### Array Guides

```ts
GenerationGuide.count(n: number)            // exact length
GenerationGuide.minItems(n: number)         // minimum length
GenerationGuide.maxItems(n: number)         // maximum length
GenerationGuide.element(guide: GenerationGuide)  // constrain elements
```

## GeneratedContent

Returned by `respondWithSchema()` and `respondWithJsonSchema()`. Call `dispose()` when done or use `using` to release resources immediately. Otherwise, cleanup happens automatically during garbage collection.

### `value()`

Extract a typed property value:

```ts
value<T>(key: string): T
```

### `toObject()`

Get the full result as a plain object:

```ts
toObject(): JsonObject
```

### `toJson()`

Get the raw JSON string of the generated content:

```ts
toJson(): string
```

### `isComplete`

```ts
readonly isComplete: boolean
```

Whether the model finished generating the full content.

### `dispose()`

Release resources held by this content. Safe to call multiple times. After disposal, `value()`, `toJson()`, and `isComplete` throw; `toObject()` still works if the result was previously cached.

```ts
dispose(): void
```

Also supports `Symbol.dispose` for use with TC39 Explicit Resource Management:

```ts
using content = await session.respondWithSchema(prompt, schema);
const data = content.toObject();
// content is released when the block exits
```

## `generable()`

Declarative schema builder with full TypeScript type inference. Returns a `Generable` object with a `schema` and a typed `parse()` method.

```ts
function generable<T extends Record<string, PropertyDef>>(
  name: string,
  properties: T,
  description?: string,
): Generable<T>
```

| Parameter | Type | Description |
| --- | --- | --- |
| `name` | `string` | Schema name |
| `properties` | `Record<string, PropertyDef>` | Property definitions |
| `description` | `string` | Optional schema description |

### `Generable<T>`

```ts
interface Generable<T> {
  readonly schema: GenerationSchema;
  parse(content: GeneratedContent): InferSchema<T>;
}
```

| Member | Description |
| --- | --- |
| `schema` | The `GenerationSchema` to pass to `respondWithSchema()` |
| `parse(content)` | Extracts a fully typed object from `GeneratedContent` |

### `PropertyDef`

A union of scalar, array, and object property definitions:

```ts
// Scalar
{ type: "string" | "integer" | "number" | "boolean"; description?: string; optional?: boolean; guides?: GenerationGuide[] }

// Array
{ type: "array"; items: PropertyDef; description?: string; optional?: boolean; guides?: GenerationGuide[] }

// Nested object
{ type: "object"; properties: Record<string, PropertyDef>; description?: string; optional?: boolean }
```

### `InferSchema<T>`

Mapped type that converts a `Record<string, PropertyDef>` into a TypeScript object type. Fields with `optional: true` become optional properties.

## GenerationSchemaProperty

Represents a single property in a schema. Created internally by `GenerationSchema.property()`.

## GuideType

Enum of guide types used internally:

| Value | Description |
| --- | --- |
| `ANY_OF` | Enumerated values |
| `CONSTANT` | Fixed value |
| `RANGE` | Numeric range |
| `MINIMUM` | Lower bound |
| `MAXIMUM` | Upper bound |
| `REGEX` | Pattern match |
| `COUNT` | Exact array length |
| `MIN_ITEMS` | Minimum array length |
| `MAX_ITEMS` | Maximum array length |
| `ELEMENT` | Element constraint |
