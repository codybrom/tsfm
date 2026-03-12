/**
 * GenerationSchema — describes the structure of a guided-generation response.
 *
 * Use these classes to tell the model what shape of data to produce.
 * This mirrors the Python SDK's GenerationSchema / GenerationSchemaProperty / GenerationGuide.
 */

import { getFunctions, decodeAndFreeString, type NativePointer } from "./bindings.js";
import { statusToError } from "./errors.js";

export type PropertyType = "string" | "integer" | "number" | "boolean" | "array" | "object";

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
    return new GenerationGuide({ type: GuideType.COUNT, value: count });
  }

  /** Apply a guide to each element of an array. */
  static element(guide: GenerationGuide): GenerationGuide {
    return new GenerationGuide({ type: GuideType.ELEMENT, value: guide });
  }

  /** Maximum number of items in an array. */
  static maxItems(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MAX_ITEMS, value });
  }

  /** Maximum numeric value. */
  static maximum(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MAXIMUM, value });
  }

  /** Minimum number of items in an array. */
  static minItems(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MIN_ITEMS, value });
  }

  /** Minimum numeric value. */
  static minimum(value: number): GenerationGuide {
    return new GenerationGuide({ type: GuideType.MINIMUM, value });
  }

  /** Constrain numeric value to [min, max]. */
  static range(min: number, max: number): GenerationGuide {
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
        fn.FMGenerationSchemaPropertyAddAnyOfGuide(propertyPointer, value, value.length, wrapped);
        break;
      }
      case GuideType.CONSTANT: {
        const choices = [value];
        fn.FMGenerationSchemaPropertyAddAnyOfGuide(
          propertyPointer,
          choices,
          choices.length,
          wrapped,
        );
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
    type: PropertyType,
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
    type: PropertyType,
    opts?: {
      description?: string;
      optional?: boolean;
      guides?: GenerationGuide[];
    },
  ): this {
    const prop = new GenerationSchemaProperty(name, type, opts);
    return this.addProperty(prop);
  }

  /** Serialize the schema to a plain object (mirrors Python's GenerationSchema.to_dict()). */
  toDict(): JsonSchema {
    const errorCode = [0];
    const pointer = getFunctions().FMGenerationSchemaGetJSONString(
      this._nativeSchema,
      errorCode,
      null,
    );
    const json = decodeAndFreeString(pointer);
    if (!json) throw statusToError(errorCode[0], "Failed to serialize GenerationSchema");
    return JSON.parse(json);
  }
}

// ---------------------------------------------------------------------------
// JSON Schema normalization for Apple's Foundation Models C API
// ---------------------------------------------------------------------------

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
  const result: JsonSchema = { ...schema };

  // Recurse into $defs entries (Apple uses $defs/$ref for nested objects)
  if (result.$defs && typeof result.$defs === "object") {
    const defs = result.$defs as Record<string, JsonSchema>;
    const normalized: Record<string, JsonSchema> = {};
    for (const [key, value] of Object.entries(defs)) {
      normalized[key] = value && typeof value === "object" ? afmSchemaFormat(value, false) : value;
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
          value && typeof value === "object" ? afmSchemaFormat(value, false) : value;
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
    result.items = afmSchemaFormat(result.items as JsonSchema, false);
  }

  // Apple requires every object to have title, properties, required, additionalProperties, and x-order
  if (result.type === "object") {
    if (!result.title) result.title = isRoot ? "Schema" : "Object";
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
 */
export class GeneratedContent {
  /** @internal */
  _nativeContent: NativePointer;

  private _parsed: JsonObject | null = null;

  /** @internal */
  constructor(pointer: NativePointer) {
    this._nativeContent = pointer;
  }

  /** Create GeneratedContent from a JSON string (mirrors Python's GeneratedContent.from_json()). */
  static fromJson(jsonString: string): GeneratedContent {
    const fn = getFunctions();
    const errorCode = [0];
    const pointer = fn.FMGeneratedContentCreateFromJSON(jsonString, errorCode, null);
    if (!pointer) throw statusToError(errorCode[0], "Failed to create GeneratedContent from JSON");
    return new GeneratedContent(pointer);
  }

  get isComplete(): boolean {
    return getFunctions().FMGeneratedContentIsComplete(this._nativeContent);
  }

  /** Returns the raw JSON string of the generated content. */
  toJson(): string {
    const pointer = getFunctions().FMGeneratedContentGetJSONString(this._nativeContent);
    return decodeAndFreeString(pointer) ?? "{}";
  }

  /** Returns the parsed JSON object. */
  toObject(): JsonObject {
    if (!this._parsed) {
      this._parsed = JSON.parse(this.toJson());
    }
    return this._parsed!;
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
    const pointer = getFunctions().FMGeneratedContentGetPropertyValue(
      this._nativeContent,
      propertyName,
      null,
      null,
    );
    const raw = decodeAndFreeString(pointer);
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
    throw new Error(`Property '${propertyName}' not found in generated content`);
  }
}
