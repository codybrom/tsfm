/**
 * GenerationSchema — describes the structure of a guided-generation response.
 *
 * Use these classes to tell the model what shape of data to produce.
 * This mirrors the Python SDK's GenerationSchema / GenerationSchemaProperty / GenerationGuide.
 */

import { getFunctions, type NativePointer } from "./bindings.js";
import { statusToError } from "./errors.js";

export type PropertyType = "string" | "integer" | "number" | "boolean" | "array" | "object";

/**
 * Compound type names used by the C bridge. Includes scalar types plus
 * array variants like `"array<string>"`, `"array<integer>"`, etc.
 */
/** A scalar type, `array<T>`, or the name of a reference schema. */
export type NativeTypeName = PropertyType | `array<${string}>` | (string & {});

type JsonPrimitive = string | number | boolean | null | undefined;

/** A JSON Schema definition object. */
export type JsonSchema = {
  [key: string]: JsonSchema | JsonSchema[] | JsonPrimitive | JsonPrimitive[];
};

/** An arbitrary parsed JSON object. */
export type JsonObject = {
  [key: string]: JsonObject | JsonObject[] | JsonPrimitive | JsonPrimitive[];
};

// ---------------------------------------------------------------------------
// GuideType — mirrors Python's GuideType enum
// ---------------------------------------------------------------------------

export enum GuideType {
  ANY_OF = "enum",
  CONSTANT = "constant",
  COUNT = "count",
  ELEMENT = "element",
  MAX_ITEMS = "maxItems",
  MAXIMUM = "maximum",
  MIN_ITEMS = "minItems",
  MINIMUM = "minimum",
  RANGE = "range",
  REGEX = "regex",
}

// ---------------------------------------------------------------------------
// GenerationGuide — mirrors Python's GenerationGuide class
// ---------------------------------------------------------------------------

type GuideData =
  | { type: GuideType.ANY_OF; value: string[] }
  | { type: GuideType.CONSTANT; value: string }
  | { type: GuideType.COUNT; value: number }
  | { type: GuideType.ELEMENT; value: GenerationGuide }
  | { type: GuideType.MAX_ITEMS; value: number }
  | { type: GuideType.MAXIMUM; value: number }
  | { type: GuideType.MIN_ITEMS; value: number }
  | { type: GuideType.MINIMUM; value: number }
  | { type: GuideType.RANGE; value: [number, number] }
  | { type: GuideType.REGEX; value: string };

/** Throws a RangeError unless `value` is a finite number. */
function finite(value: number, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${what} must be a finite number, got ${String(value)}`);
  }
  return value;
}

/** Throws a RangeError unless `value` is a non-negative safe integer. */
function itemCount(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${what} must be a non-negative integer, got ${String(value)}`);
  }
  return value;
}

export class GenerationGuide {
  private readonly data: GuideData;

  private constructor(data: GuideData) {
    this.data = data;
  }

  /** Constrain output to one of the given string values. */
  static anyOf(values: string[]): GenerationGuide {
    return new GenerationGuide({ type: GuideType.ANY_OF, value: values });
  }

  /** Constrain output to exactly this string value. */
  static constant(value: string): GenerationGuide {
    return new GenerationGuide({ type: GuideType.CONSTANT, value });
  }

  /** Require exactly `count` items in an array. */
  static count(count: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.COUNT, value: itemCount(count, "count") });
  }

  /** Apply a guide to each element of an array. */
  static element(guide: GenerationGuide): GenerationGuide {
    return new GenerationGuide({ type: GuideType.ELEMENT, value: guide });
  }

  /** Maximum number of items in an array. */
  static maxItems(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MAX_ITEMS, value: itemCount(value, "maxItems") });
  }

  /** Maximum numeric value. */
  static maximum(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MAXIMUM, value: finite(value, "maximum") });
  }

  /** Minimum number of items in an array. */
  static minItems(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MIN_ITEMS, value: itemCount(value, "minItems") });
  }

  /** Minimum numeric value. */
  static minimum(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MINIMUM, value: finite(value, "minimum") });
  }

  /** Constrain numeric value to [min, max]. */
  static range(min: number, max: number): GenerationGuide {
    finite(min, "range minimum");
    finite(max, "range maximum");
    if (min > max) {
      throw new RangeError(`range minimum ${min} is above its maximum ${max}`);
    }
    return new GenerationGuide({ type: GuideType.RANGE, value: [min, max] });
  }

  /** Constrain string to match a regex pattern. */
  static regex(pattern: string): GenerationGuide {
    return new GenerationGuide({ type: GuideType.REGEX, value: pattern });
  }

  /** @internal Apply this guide to a C property pointer. */
  _applyToProperty(propertyPointer: NativePointer, wrapped = false): void {
    const fn = getFunctions();
    const { type, value } = this.data;

    if (type === GuideType.ELEMENT) {
      value._applyToProperty(propertyPointer, true);
      return;
    }

    switch (type) {
      case GuideType.ANY_OF: {
        fn.FMGenerationSchemaPropertyAddAnyOfGuide(propertyPointer, value, wrapped);
        break;
      }
      case GuideType.CONSTANT: {
        fn.FMGenerationSchemaPropertyAddAnyOfGuide(propertyPointer, [value], wrapped);
        break;
      }
      case GuideType.COUNT:
        fn.FMGenerationSchemaPropertyAddCountGuide(propertyPointer, value, wrapped);
        break;
      case GuideType.MAX_ITEMS:
        fn.FMGenerationSchemaPropertyAddMaxItemsGuide(propertyPointer, value);
        break;
      case GuideType.MAXIMUM:
        fn.FMGenerationSchemaPropertyAddMaximumGuide(propertyPointer, value, wrapped);
        break;
      case GuideType.MIN_ITEMS:
        fn.FMGenerationSchemaPropertyAddMinItemsGuide(propertyPointer, value);
        break;
      case GuideType.MINIMUM:
        fn.FMGenerationSchemaPropertyAddMinimumGuide(propertyPointer, value, wrapped);
        break;
      case GuideType.RANGE: {
        const [min, max] = value;
        fn.FMGenerationSchemaPropertyAddRangeGuide(propertyPointer, min, max, wrapped);
        break;
      }
      case GuideType.REGEX:
        fn.FMGenerationSchemaPropertyAddRegex(propertyPointer, value, wrapped);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// GenerationSchemaProperty
// ---------------------------------------------------------------------------

export class GenerationSchemaProperty {
  /** @internal */
  _nativeProperty: NativePointer;

  constructor(
    name: string,
    type: NativeTypeName,
    opts: {
      description?: string;
      optional?: boolean;
      guides?: GenerationGuide[];
    } = {},
  ) {
    const fn = getFunctions();
    this._nativeProperty = fn.FMGenerationSchemaPropertyCreate(
      name,
      opts.description ?? null,
      type,
      opts.optional ?? false,
    );

    for (const guide of opts.guides ?? []) {
      guide._applyToProperty(this._nativeProperty);
    }
  }
}

// ---------------------------------------------------------------------------
// GenerationSchema
// ---------------------------------------------------------------------------

export class GenerationSchema {
  /** @internal */
  _nativeSchema: NativePointer;

  constructor(name: string, description?: string) {
    const fn = getFunctions();
    this._nativeSchema = fn.FMGenerationSchemaCreate(name, description ?? null);
  }

  addProperty(property: GenerationSchemaProperty): this {
    getFunctions().FMGenerationSchemaAddProperty(this._nativeSchema, property._nativeProperty);
    return this;
  }

  addReferenceSchema(schema: GenerationSchema): this {
    getFunctions().FMGenerationSchemaAddReferenceSchema(this._nativeSchema, schema._nativeSchema);
    return this;
  }

  /** Convenience: add a typed property inline. */
  property(
    name: string,
    type: NativeTypeName,
    opts?: {
      description?: string;
      optional?: boolean;
      guides?: GenerationGuide[];
    },
  ): this {
    if (type === "array") {
      throw new Error(
        `Bare "array" type is not supported by the C bridge. ` +
          `Use a compound type like "array<string>" or "array<integer>", ` +
          `or use generable() for automatic type resolution.`,
      );
    }
    const prop = new GenerationSchemaProperty(name, type, opts);
    return this.addProperty(prop);
  }

  /** Serialize the schema to a plain object (mirrors Python's GenerationSchema.to_dict()). */
  toDict(): JsonSchema {
    const { value: json, status } = getFunctions().FMGenerationSchemaGetJSONString(
      this._nativeSchema,
    );
    if (!json) throw statusToError(status, "Failed to serialize GenerationSchema");
    return JSON.parse(json);
  }
}

// ---------------------------------------------------------------------------
// generable() — declarative schema builder with typed parsing
// ---------------------------------------------------------------------------

/** Property definition for scalar types. */
export interface ScalarPropertyDef {
  type: "string" | "integer" | "number" | "boolean";
  description?: string;
  optional?: boolean;
  guides?: GenerationGuide[];
}

/** Property definition for array types. */
export interface ArrayPropertyDef {
  type: "array";
  items: PropertyDef;
  description?: string;
  optional?: boolean;
  guides?: GenerationGuide[];
}

/** Property definition for nested object types. */
export interface ObjectPropertyDef {
  type: "object";
  properties: Record<string, PropertyDef>;
  description?: string;
  optional?: boolean;
}

/** Union of all property definition shapes. */
export type PropertyDef = ScalarPropertyDef | ArrayPropertyDef | ObjectPropertyDef;

/** Maps a scalar type string to its TypeScript type. */
type InferScalar<T extends string> = T extends "string"
  ? string
  : T extends "integer" | "number"
    ? number
    : T extends "boolean"
      ? boolean
      : unknown;

/** Maps a single PropertyDef to its TypeScript type. */
type InferPropertyType<D extends PropertyDef> = D extends {
  type: "array";
  items: infer I extends PropertyDef;
}
  ? InferPropertyType<I>[]
  : D extends { type: "object"; properties: infer P extends Record<string, PropertyDef> }
    ? InferSchema<P>
    : D extends { type: infer T extends string }
      ? InferScalar<T>
      : unknown;

/** Keys of T where optional is not literally true. */
type RequiredKeys<T extends Record<string, PropertyDef>> = {
  [K in keyof T]: T[K] extends { optional: true } ? never : K;
}[keyof T];

/** Keys of T where optional is literally true. */
type OptionalKeys<T extends Record<string, PropertyDef>> = {
  [K in keyof T]: T[K] extends { optional: true } ? K : never;
}[keyof T];

/** Maps a record of PropertyDefs to a typed object, respecting optional fields. */
export type InferSchema<T extends Record<string, PropertyDef>> = {
  [K in RequiredKeys<T>]: InferPropertyType<T[K]>;
} & {
  [K in OptionalKeys<T>]?: InferPropertyType<T[K]>;
};

/** The return type of `generable()`. */
export interface Generable<T extends Record<string, PropertyDef>> {
  /** The GenerationSchema ready to pass to `respondWithSchema()`. */
  readonly schema: GenerationSchema;
  /** Parse a GeneratedContent into a fully typed object. */
  parse(content: GeneratedContent): InferSchema<T>;
}

/** Map a scalar PropertyDef type to the C bridge type name (matches Python SDK convention). */
function arrayElementTypeName(def: PropertyDef): string {
  if (def.type === "object") return def.type; // resolved via reference schema
  return def.type; // "string" | "integer" | "number" | "boolean"
}

/** Where a property sits while `generable()` builds a schema. */
interface SchemaBuildContext {
  /** The schema passed to the request; every reference schema is registered on it. */
  root: GenerationSchema;
  /** Reference schema names already used under `root`. */
  usedNames: Set<string>;
  /** Property names from the root to the property's parent. */
  path: string[];
}

/**
 * Type names the bridge reads as scalars. A reference schema with one of these
 * names would be built as that scalar instead.
 */
const RESERVED_TYPE_NAMES = [
  "string",
  "number",
  "float",
  "double",
  "integer",
  "int",
  "boolean",
  "bool",
];

/**
 * The name for a nested object's reference schema: its property path joined
 * with "_" (`shipping_address`), so objects under the same key in different
 * places don't collide. The framework resolves references by name. Characters
 * other than letters, digits and "_" become "_", because the bridge matches
 * `array<Name>` with `\w+`. A name that is reserved or already taken gets a
 * numeric suffix.
 */
function referenceName(ctx: SchemaBuildContext, key: string): string {
  const base = [...ctx.path, key].join("_").replace(/\W/g, "_") || "_";
  let name = base;
  for (let n = 2; ctx.usedNames.has(name); n++) name = `${base}_${n}`;
  ctx.usedNames.add(name);
  return name;
}

/** Builds a nested object's reference schema and registers it on the root. */
function addReferenceSchema(ctx: SchemaBuildContext, key: string, def: ObjectPropertyDef): string {
  const name = referenceName(ctx, key);
  const nested = new GenerationSchema(name, def.description);
  const inner = { ...ctx, path: [...ctx.path, key] };
  for (const [childKey, childDef] of Object.entries(def.properties)) {
    addPropertyDef(nested, childKey, childDef, inner);
  }
  // The framework resolves references only from the schema passed to the
  // request, not from the reference schemas themselves.
  ctx.root.addReferenceSchema(nested);
  return name;
}

/** Recursively adds a property definition to a GenerationSchema. */
function addPropertyDef(
  schema: GenerationSchema,
  name: string,
  def: PropertyDef,
  ctx: SchemaBuildContext,
): void {
  if (def.type === "object") {
    // The property's type is the reference schema's name, as for arrays of
    // objects below. Typing it "object" leaves an undefined reference.
    const typeName = addReferenceSchema(ctx, name, def);
    schema.addProperty(
      new GenerationSchemaProperty(name, typeName, {
        description: def.description,
        optional: def.optional,
      }),
    );
  } else if (def.type === "array") {
    // Build compound type name like "array<string>" or "array<Name>" to match
    // the convention expected by Apple's C bridge (see python-apple-fm-sdk).
    const elementType =
      def.items.type === "object"
        ? addReferenceSchema(ctx, name, def.items)
        : arrayElementTypeName(def.items);
    schema.addProperty(
      new GenerationSchemaProperty(name, `array<${elementType}>`, {
        description: def.description,
        optional: def.optional,
        guides: def.guides,
      }),
    );
  } else {
    schema.addProperty(
      new GenerationSchemaProperty(name, def.type, {
        description: def.description,
        optional: def.optional,
        guides: def.guides,
      }),
    );
  }
}

/**
 * Define a typed schema for structured generation.
 *
 * Returns an object with a `schema` (for `respondWithSchema()`) and a typed
 * `parse()` method that converts `GeneratedContent` into a plain object.
 *
 * ```ts
 * const MovieReview = generable("MovieReview", {
 *   title: { type: "string", description: "Movie title" },
 *   rating: { type: "integer", guides: [GenerationGuide.range(1, 5)] },
 *   review: { type: "string" },
 * });
 *
 * const { content } = await session.respondWithSchema("Review Inception", MovieReview.schema);
 * const review = MovieReview.parse(content);
 * // review.title: string, review.rating: number, review.review: string
 * ```
 */
export function generable<const T extends Record<string, PropertyDef>>(
  name: string,
  properties: T,
  description?: string,
): Generable<T> {
  const schema = new GenerationSchema(name, description);
  const ctx: SchemaBuildContext = {
    root: schema,
    usedNames: new Set([name, ...RESERVED_TYPE_NAMES]),
    path: [],
  };
  for (const [key, def] of Object.entries(properties)) {
    addPropertyDef(schema, key, def, ctx);
  }
  return {
    schema,
    /** Assumes model output conforms to the schema (enforced at generation time). */
    parse(content: GeneratedContent): InferSchema<T> {
      return content.toObject<InferSchema<T>>();
    },
  };
}

// ---------------------------------------------------------------------------
// JSON Schema normalization for Apple Foundation Models C API
// ---------------------------------------------------------------------------

/**
 * The deepest JSON nesting a schema may have. Apple's framework decodes a
 * schema recursively on a background thread with a small stack, and a schema
 * nested a few hundred levels deep overflows it, which kills the process
 * (Swift can't catch a stack overflow). Real schemas are nowhere near this.
 *
 * @internal
 */
export const MAX_SCHEMA_DEPTH = 128;

/**
 * Returns how deeply `value` nests objects and arrays, counting up to `limit`
 * and stopping there. Iterative, so hostile input can't overflow the JS stack.
 * An object that contains itself is infinitely deep, so a cycle returns
 * `Infinity`; an object shared by several parents is not a cycle.
 *
 * @internal
 */
export function jsonNestingDepth(value: unknown, limit = Infinity): number {
  let deepest = 0;
  // The objects on the path from the root to the current node.
  const onPath = new Set<object>();
  const stack: Array<{ node: unknown; depth: number; exit?: true }> = [{ node: value, depth: 1 }];
  while (stack.length > 0) {
    const { node, depth, exit } = stack.pop()!;
    if (node === null || typeof node !== "object") continue;
    if (exit) {
      onPath.delete(node);
      continue;
    }
    if (onPath.has(node)) return Infinity;
    if (depth > deepest) {
      deepest = depth;
      if (deepest > limit) return deepest;
    }
    onPath.add(node);
    stack.push({ node, depth, exit: true });
    for (const child of Object.values(node)) stack.push({ node: child, depth: depth + 1 });
  }
  return deepest;
}

/**
 * Claims `title` for one object, adding a numeric suffix if it's taken. Apple
 * resolves object types by title, so a duplicate makes one object adopt the
 * other's properties.
 */
function reserveTitle(title: string, used: Set<string>): string {
  let unique = title;
  for (let n = 2; used.has(unique); n++) unique = `${title}_${n}`;
  used.add(unique);
  return unique;
}

/**
 * Normalize a JSON Schema object for the Foundation Models C API.
 *
 * The AFM schema parser requires every `object` node to have `title`,
 * `properties`, `required`, `additionalProperties`, and `x-order`. This
 * function recursively fills in missing keys with sensible defaults. Also
 * recurses into `$defs` entries (used for nested objects via `$ref`).
 *
 * @internal
 */
export function afmSchemaFormat(schema: JsonSchema, isRoot = true): JsonSchema {
  // Titles written into the schema are reserved first: a generated one must
  // move aside rather than rename a title a $ref may point at.
  const used = new Set<string>();
  collectTitles(schema, used);
  return formatSchema(schema, isRoot, [], used);
}

let _warnedDuplicateTitle = false;

/** Records one title, warning the first time a schema reuses one. */
function noteTitle(title: string, into: Set<string>, seen: Set<string>): void {
  if (seen.has(title) && !_warnedDuplicateTitle) {
    _warnedDuplicateTitle = true;
    console.warn(
      `[tsfm] Two objects in this schema are titled "${title}". The model keys object types by ` +
        `title, so one will take the other's shape. Give them distinct titles.`,
    );
  }
  seen.add(title);
  into.add(title);
}

/**
 * Every title already in the schema, at any depth. Two objects sharing one is
 * reported: the framework keys object types by title, so the second silently
 * takes the first's shape, and a written title can't be renamed here because a
 * $ref may point at it.
 */
function collectTitles(
  node: unknown,
  into: Set<string>,
  seen = new Set<string>(),
  // A $defs entry's own title is ignored: formatSchema replaces it with the
  // key, so counting both would report the same object twice.
  skipOwnTitle = false,
): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectTitles(item, into, seen);
    return;
  }
  const record = node as Record<string, unknown>;
  const defs =
    record.$defs && typeof record.$defs === "object" && !Array.isArray(record.$defs)
      ? (record.$defs as Record<string, unknown>)
      : null;
  // A $defs entry is titled by its key, so the key is a title even though it
  // isn't written as one; Apple resolves "#/$defs/<key>" that way.
  if (defs) {
    for (const [key, value] of Object.entries(defs)) {
      noteTitle(key, into, seen);
      collectTitles(value, into, seen, true);
    }
  }
  if (!skipOwnTitle && typeof record.title === "string" && record.title) {
    noteTitle(record.title, into, seen);
  }
  for (const [key, value] of Object.entries(record)) {
    if (key !== "title" && key !== "$defs") collectTitles(value, into, seen);
  }
}

/**
 * `path` is where this subschema sits, used to title untitled objects; `used`
 * holds the titles already taken, because the framework keys object types by
 * title and two objects sharing one silently take the same shape.
 */
function formatSchema(
  schema: JsonSchema,
  isRoot: boolean,
  path: string[],
  used: Set<string>,
): JsonSchema {
  const result: JsonSchema = { ...schema };

  // Recurse into $defs entries (Apple uses $defs/$ref for nested objects)
  if (result.$defs && typeof result.$defs === "object") {
    const defs = result.$defs as Record<string, JsonSchema>;
    const normalized: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(defs)) {
      // Apple resolves "#/$defs/<key>" by the definition's title, so the title
      // must be its key; otherwise every $ref is an undefined reference.
      normalized[key] =
        value && typeof value === "object"
          ? formatSchema({ ...value, title: key }, false, [key], used)
          : value;
    }
    result.$defs = normalized;
  }

  // Recurse into properties (skip $ref properties — they reference $defs)
  if (result.properties && typeof result.properties === "object") {
    const props = result.properties as Record<string, JsonSchema>;
    const normalized: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(props)) {
      if (value && typeof value === "object" && "$ref" in value) {
        normalized[key] = value;
      } else {
        normalized[key] =
          value && typeof value === "object"
            ? formatSchema(value, false, [...path, key], used)
            : value;
      }
    }
    result.properties = normalized;
  }

  // Recurse into array items (e.g. { type: "array", items: { type: "object", ... } })
  if (
    result.items &&
    typeof result.items === "object" &&
    !Array.isArray(result.items) &&
    !("$ref" in (result.items as JsonSchema))
  ) {
    result.items = formatSchema(result.items as JsonSchema, false, [...path, "item"], used);
  }

  // Apple requires every object to have title, properties, required, additionalProperties, and x-order
  if (result.type === "object") {
    // A title already in the schema stays exactly as written.
    if (typeof result.title !== "string" || !result.title) {
      result.title = reserveTitle(isRoot ? "Schema" : path.join("_") || "Object", used);
    }
    if (!result.properties) result.properties = {};
    if (!result.required) result.required = [];
    if (!("additionalProperties" in result)) result.additionalProperties = false;
    if (!result["x-order"]) {
      result["x-order"] = Object.keys(result.properties as object);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// GeneratedContent
// ---------------------------------------------------------------------------

/**
 * The structured content returned from guided-generation requests.
 *
 * Call `dispose()` when done to release the underlying C object immediately;
 * otherwise it is released automatically when the instance is garbage collected.
 */
export class GeneratedContent {
  /** @internal */
  _nativeContent: NativePointer | null;

  private _parsed: JsonObject | null = null;

  /** @internal */
  constructor(pointer: NativePointer) {
    // The handle releases the native object when it's garbage collected.
    this._nativeContent = pointer;
  }

  /** Create GeneratedContent from a JSON string (mirrors Python's GeneratedContent.from_json()). */
  static fromJson(jsonString: string): GeneratedContent {
    const { value, status } = getFunctions().FMGeneratedContentCreateFromJSON(jsonString);
    if (!value) throw statusToError(status, "Failed to create GeneratedContent from JSON");
    return new GeneratedContent(value);
  }

  /** @internal Throws if the content has been disposed. */
  private _assertNotDisposed(): void {
    if (!this._nativeContent) {
      throw new Error("GeneratedContent has been disposed");
    }
  }

  get isComplete(): boolean {
    this._assertNotDisposed();
    return getFunctions().FMGeneratedContentIsComplete(this._nativeContent!);
  }

  /** Returns the raw JSON string of the generated content. */
  toJson(): string {
    this._assertNotDisposed();
    return getFunctions().FMGeneratedContentGetJSONString(this._nativeContent!) ?? "{}";
  }

  /**
   * Returns the parsed JSON object.
   *
   * Pass a type argument to get the shape the schema guarantees — e.g.
   * `toObject<{ results: TriageResult[] }>()` — instead of asserting at the
   * call site. Like `value<T>()`, the type argument is a claim about model
   * output that guided generation enforces at generation time, not a runtime
   * check. Defaults to `JsonObject`.
   */
  toObject<T = JsonObject>(): T {
    if (!this._parsed) {
      const json = this.toJson();
      try {
        this._parsed = JSON.parse(json);
      } catch {
        throw new Error(
          `Failed to parse generated content as JSON. Raw content: ${json.slice(0, 200)}`,
        );
      }
    }
    return this._parsed! as T;
  }

  /**
   * Returns the value of a named property, parsed from JSON.
   *
   * Tries the C API's per-property accessor first; falls back to parsing the
   * full JSON object when the C API returns null.
   *
   * **Type safety note:** when the C API returns a non-JSON string for a
   * property (rare), `JSON.parse` fails and the raw string is returned cast
   * to `T`. The actual runtime value may be a `string` even when `T` is a
   * different type. If type fidelity matters, use `toObject()` and access the
   * property directly.
   *
   * Throws if the property is not found by either path.
   */
  value<T = unknown>(propertyName: string): T {
    this._assertNotDisposed();
    const {
      value: raw,
      status,
      description,
    } = getFunctions().FMGeneratedContentGetPropertyValue(this._nativeContent!, propertyName);
    if (raw !== null) {
      try {
        return JSON.parse(raw);
      } catch {
        return raw as unknown as T;
      }
    }
    // Fall back to JSON representation when the C API returns null
    const obj = this.toObject();
    if (propertyName in obj) {
      return obj[propertyName] as T;
    }
    // Neither path found it. If the native read failed, say why.
    if (status !== 0) {
      throw statusToError(
        status,
        `Property '${propertyName}' not found in generated content${description ? `: ${description}` : ""}`,
      );
    }
    throw new Error(`Property '${propertyName}' not found in generated content`);
  }

  /** Release the underlying C content object. Safe to call multiple times. */
  dispose(): void {
    if (this._nativeContent) {
      getFunctions().FMRelease(this._nativeContent);
      this._nativeContent = null;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}
