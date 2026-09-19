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

`"array"` and `"object"` are the vocabulary of `generable()` property definitions, where an array carries its `items` and an object its `properties`. `property()` takes a `NativeTypeName` instead, and there a bare `"array"` is rejected at runtime: give the element type as `"array<string>"`, `"array<integer>"`, and so on, and name a reference schema for objects.

## GenerationGuide

Factory methods that create output constraints for schema properties.

### String Guides

```ts
GenerationGuide.anyOf(values: string[])    // enumerated values
GenerationGuide.constant(value: string)     // exact value
GenerationGuide.regex(pattern: string)      // regex pattern (see supported syntax below)
```

### Regex patterns

The on-device model supports a subset of regex syntax in `regex` guides and JSON
Schema `pattern`. Apple documents no restrictions; this table is tsfm's own
measurement on macOS 27.0 (AFM 3 Core Advanced), and a later model may differ:

| Supported | Not supported |
| --- | --- |
| Literals and `.` | Character classes `[a-z]`, `[^a]` (use `\d`, `\w`, `\s` or `(a\|b\|c)`) |
| `\d`, `\w`, `\s` | Anchors `^`, `$` (patterns already match the whole value) |
| Escaped punctuation: `\.`, `\-`, `\(`, `\[`, `\^`, `\$`, `\{` … | Other escapes: `\D`, `\W`, `\S`, `\b`, `\n`, `\t`, `\p{…}`, `\x41`, `\\` |
| Groups `(…)`, nested and quantified, with `\|` | `(?…)` groups: non-capturing, lookaround, named |
| `*`, `+`, `?`, `{m}`, `{m,n}` | Lazy or possessive quantifiers: `+?`, `*+`, `{2,3}?`; backreferences |

`respondWithSchema()` and `respondWithJsonSchema()` check patterns before the
request and throw `UnsupportedGuideError` naming the construct and where it is.
Without that check, `(?:…)` makes the model generate until it fills the context
window, and the others fail with an unhelpful error.

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
using content = (await session.respondWithSchema(prompt, schema)).content;
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
