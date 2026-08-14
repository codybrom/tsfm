import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeAndFreeString: vi.fn((pointer: unknown) => {
    if (!pointer) return null;
    return '{"name":"test"}';
  }),
}));

import {
  GeneratedContent,
  GenerationGuide,
  GenerationSchema,
  GenerationSchemaProperty,
  afmSchemaFormat,
  generable,
  type JsonSchema,
} from "../../src/schema.js";
import type { NativePointer } from "../../src/bindings.js";

const mockPointer = (label: string) => label as unknown as NativePointer;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("afmSchemaFormat", () => {
  it("adds title and additionalProperties defaults", () => {
    const result = afmSchemaFormat({ type: "object", properties: { name: { type: "string" } } });
    expect(result.title).toBe("Schema");
    expect(result.additionalProperties).toBe(false);
  });

  it("derives x-order from properties keys when not provided", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: { age: { type: "number" }, name: { type: "string" } },
    });
    expect(result["x-order"]).toEqual(["age", "name"]);
  });

  it("preserves caller-supplied x-order", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: { age: { type: "number" }, name: { type: "string" } },
      "x-order": ["name", "age"],
    });
    expect(result["x-order"]).toEqual(["name", "age"]);
  });

  it("produces empty x-order when properties is absent", () => {
    const result = afmSchemaFormat({ type: "object" });
    expect(result["x-order"]).toEqual([]);
  });

  it("caller-supplied title overrides the default", () => {
    const result = afmSchemaFormat({ title: "Person", type: "object", properties: {} });
    expect(result.title).toBe("Person");
  });

  it("does not mutate the input object", () => {
    const input = { type: "object", properties: { x: { type: "string" } } };
    afmSchemaFormat(input);
    expect(Object.keys(input)).not.toContain("title");
    expect(Object.keys(input)).not.toContain("additionalProperties");
  });

  it("recursively normalizes nested object properties", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: {
        nested: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        },
      },
    });
    const nested = (result.properties as Record<string, Record<string, unknown>>).nested;
    expect(nested.title).toBe("Object");
    expect(nested.required).toEqual([]);
    expect(nested.additionalProperties).toBe(false);
    expect(nested["x-order"]).toEqual(["name"]);
  });

  it("preserves explicit additionalProperties on nested objects", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: {
        open: {
          type: "object",
          additionalProperties: true,
        },
      },
    });
    const open = (result.properties as Record<string, Record<string, unknown>>).open;
    expect(open.additionalProperties).toBe(true);
  });

  it("adds required to object types without it", () => {
    const result = afmSchemaFormat({ type: "object" });
    expect(result.required).toEqual([]);
  });

  it("uses 'Object' as title for non-root objects", () => {
    const result = afmSchemaFormat(
      { type: "object", properties: { a: { type: "string" } } },
      false,
    );
    expect(result.title).toBe("Object");
  });

  it("passes through falsy property values without recursing", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: { empty: null },
    } as JsonSchema);
    const props = result.properties as Record<string, unknown>;
    expect(props.empty).toBeNull();
  });

  it("recursively normalizes $defs entries", () => {
    const result = afmSchemaFormat({
      $defs: {
        Inner: {
          type: "object",
          properties: { name: { type: "string" } },
        },
      },
      type: "object",
      properties: {
        ref: { $ref: "#/$defs/Inner" },
      },
    });
    const defs = result.$defs as Record<string, Record<string, unknown>>;
    expect(defs.Inner.title).toBe("Object");
    expect(defs.Inner.required).toEqual([]);
    expect(defs.Inner.additionalProperties).toBe(false);
    expect(defs.Inner["x-order"]).toEqual(["name"]);
  });

  it("passes through non-object $defs entries unchanged", () => {
    const result = afmSchemaFormat({
      $defs: {
        Inner: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        Alias: "string",
      },
      type: "object",
      properties: {},
    } as JsonSchema);
    const defs = result.$defs as Record<string, unknown>;
    expect(defs.Alias).toBe("string");
  });

  it("preserves $ref properties without recursing into them", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: {
        nested: { $ref: "#/$defs/Something", description: "A reference" },
      },
    });
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.nested.$ref).toBe("#/$defs/Something");
    expect(props.nested.description).toBe("A reference");
    // Should NOT have title, additionalProperties, etc. added
    expect(props.nested.title).toBeUndefined();
  });

  it("recursively normalizes array items with nested objects", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: {
        people: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" },
            },
          },
        },
      },
    });
    const props = result.properties as Record<string, Record<string, unknown>>;
    const items = props.people.items as Record<string, unknown>;
    expect(items.title).toBe("Object");
    expect(items.required).toEqual([]);
    expect(items.additionalProperties).toBe(false);
    expect(items["x-order"]).toEqual(["name", "age"]);
  });

  it("skips array items with $ref", () => {
    const result = afmSchemaFormat({
      type: "object",
      properties: {
        people: {
          type: "array",
          items: { $ref: "#/$defs/Person" },
        },
      },
    });
    const props = result.properties as Record<string, Record<string, unknown>>;
    const items = props.people.items as Record<string, unknown>;
    expect(items.$ref).toBe("#/$defs/Person");
    expect(items.title).toBeUndefined();
  });
});

describe("GenerationGuide", () => {
  it("anyOf creates guide with string values", () => {
    const guide = GenerationGuide.anyOf(["a", "b", "c"]);
    expect(guide).toBeInstanceOf(GenerationGuide);
  });

  it("constant creates guide with single value", () => {
    const guide = GenerationGuide.constant("hello");
    expect(guide).toBeInstanceOf(GenerationGuide);
  });

  it("count creates guide with number", () => {
    const guide = GenerationGuide.count(5);
    expect(guide).toBeInstanceOf(GenerationGuide);
  });

  it("range creates guide with min and max", () => {
    const guide = GenerationGuide.range(0, 100);
    expect(guide).toBeInstanceOf(GenerationGuide);
  });

  it("regex creates guide with pattern", () => {
    const guide = GenerationGuide.regex("^[a-z]+$");
    expect(guide).toBeInstanceOf(GenerationGuide);
  });

  it("minimum creates guide", () => {
    expect(GenerationGuide.minimum(0)).toBeInstanceOf(GenerationGuide);
  });

  it("maximum creates guide", () => {
    expect(GenerationGuide.maximum(100)).toBeInstanceOf(GenerationGuide);
  });

  it("minItems creates guide", () => {
    expect(GenerationGuide.minItems(1)).toBeInstanceOf(GenerationGuide);
  });

  it("maxItems creates guide", () => {
    expect(GenerationGuide.maxItems(10)).toBeInstanceOf(GenerationGuide);
  });

  it("element wraps inner guide", () => {
    const inner = GenerationGuide.range(0, 10);
    expect(GenerationGuide.element(inner)).toBeInstanceOf(GenerationGuide);
  });
});

describe("GenerationGuide._applyToProperty", () => {
  it("anyOf calls FMGenerationSchemaPropertyAddAnyOfGuide", () => {
    const guide = GenerationGuide.anyOf(["a", "b"]);
    guide._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddAnyOfGuide).toHaveBeenCalledWith(
      "mock-property",
      ["a", "b"],
      2,
      false,
    );
  });

  it("constant calls FMGenerationSchemaPropertyAddAnyOfGuide with single value", () => {
    const guide = GenerationGuide.constant("fixed");
    guide._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddAnyOfGuide).toHaveBeenCalledWith(
      "mock-property",
      ["fixed"],
      1,
      false,
    );
  });

  it("count calls FMGenerationSchemaPropertyAddCountGuide", () => {
    const guide = GenerationGuide.count(3);
    guide._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddCountGuide).toHaveBeenCalledWith(
      "mock-property",
      3,
      false,
    );
  });

  it("range calls FMGenerationSchemaPropertyAddRangeGuide", () => {
    const guide = GenerationGuide.range(1, 10);
    guide._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddRangeGuide).toHaveBeenCalledWith(
      "mock-property",
      1,
      10,
      false,
    );
  });

  it("regex calls FMGenerationSchemaPropertyAddRegex", () => {
    const guide = GenerationGuide.regex("^\\d+$");
    guide._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddRegex).toHaveBeenCalledWith(
      "mock-property",
      "^\\d+$",
      false,
    );
  });

  it("minimum calls FMGenerationSchemaPropertyAddMinimumGuide", () => {
    GenerationGuide.minimum(5)._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddMinimumGuide).toHaveBeenCalledWith(
      "mock-property",
      5,
      false,
    );
  });

  it("maximum calls FMGenerationSchemaPropertyAddMaximumGuide", () => {
    GenerationGuide.maximum(50)._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddMaximumGuide).toHaveBeenCalledWith(
      "mock-property",
      50,
      false,
    );
  });

  it("minItems calls FMGenerationSchemaPropertyAddMinItemsGuide", () => {
    GenerationGuide.minItems(2)._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddMinItemsGuide).toHaveBeenCalledWith(
      "mock-property",
      2,
    );
  });

  it("maxItems calls FMGenerationSchemaPropertyAddMaxItemsGuide", () => {
    GenerationGuide.maxItems(8)._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddMaxItemsGuide).toHaveBeenCalledWith(
      "mock-property",
      8,
    );
  });

  it("element unwraps and applies inner guide with wrapped=true", () => {
    const inner = GenerationGuide.range(0, 10);
    GenerationGuide.element(inner)._applyToProperty(mockPointer("mock-property"));
    expect(mockFns.FMGenerationSchemaPropertyAddRangeGuide).toHaveBeenCalledWith(
      "mock-property",
      0,
      10,
      true,
    );
  });
});

describe("GenerationSchemaProperty", () => {
  it("creates property with name and type", () => {
    const prop = new GenerationSchemaProperty("name", "string");
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "name",
      null,
      "string",
      false,
    );
    expect(prop._nativeProperty).toBe("mock-prop-pointer");
  });

  it("passes description and optional flag", () => {
    new GenerationSchemaProperty("age", "integer", {
      description: "Age in years",
      optional: true,
    });
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "age",
      "Age in years",
      "integer",
      true,
    );
  });

  it("applies guides during construction", () => {
    new GenerationSchemaProperty("score", "number", {
      guides: [GenerationGuide.range(0, 100)],
    });
    expect(mockFns.FMGenerationSchemaPropertyAddRangeGuide).toHaveBeenCalled();
  });
});

describe("GenerationSchema", () => {
  it("creates schema with name and description", () => {
    const schema = new GenerationSchema("Cat", "A cat");
    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledWith("Cat", "A cat");
    expect(schema._nativeSchema).toBe("mock-schema-pointer");
  });

  it("creates schema with null description when omitted", () => {
    new GenerationSchema("Dog");
    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledWith("Dog", null);
  });

  it("addProperty calls FFI and returns this for chaining", () => {
    const schema = new GenerationSchema("Test");
    const prop = new GenerationSchemaProperty("field", "string");
    const result = schema.addProperty(prop);
    expect(mockFns.FMGenerationSchemaAddProperty).toHaveBeenCalledWith(
      "mock-schema-pointer",
      "mock-prop-pointer",
    );
    expect(result).toBe(schema);
  });

  it("property() convenience method chains", () => {
    const schema = new GenerationSchema("Test")
      .property("name", "string")
      .property("age", "integer");
    expect(mockFns.FMGenerationSchemaAddProperty).toHaveBeenCalledTimes(2);
    expect(schema._nativeSchema).toBe("mock-schema-pointer");
  });

  it("property() accepts compound array type names", () => {
    const schema = new GenerationSchema("Test");
    schema.property("tags", "array<string>");
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "tags",
      null,
      "array<string>",
      false,
    );
  });

  it("property() rejects bare 'array' type", () => {
    const schema = new GenerationSchema("Test");
    expect(() => schema.property("items", "array")).toThrow(
      'Bare "array" type is not supported by the C bridge',
    );
  });

  it("addReferenceSchema calls FFI", () => {
    const schema = new GenerationSchema("Main");
    const ref = new GenerationSchema("Ref");
    schema.addReferenceSchema(ref);
    expect(mockFns.FMGenerationSchemaAddReferenceSchema).toHaveBeenCalledWith(
      "mock-schema-pointer",
      "mock-schema-pointer",
    );
  });

  it("toDict parses JSON from FFI", () => {
    const schema = new GenerationSchema("Test");
    const dict = schema.toDict();
    expect(dict).toEqual({ name: "test" });
  });

  it("toDict throws when decodeAndFreeString returns null", async () => {
    const mod = await import("../../src/bindings.js");
    const mockDecode = mod.decodeAndFreeString as ReturnType<typeof vi.fn>;
    mockDecode.mockReturnValueOnce(null);

    const schema = new GenerationSchema("Bad");
    expect(() => schema.toDict()).toThrow();
  });
});

describe("GeneratedContent", () => {
  // Get a handle on the mocked decodeAndFreeString so we can control it per-test
  let mockDecodeAndFreeString: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    const mod = await import("../../src/bindings.js");
    mockDecodeAndFreeString = mod.decodeAndFreeString as ReturnType<typeof vi.fn>;
  });

  it("fromJson creates instance from JSON string", () => {
    const content = GeneratedContent.fromJson('{"name":"test"}');
    expect(mockFns.FMGeneratedContentCreateFromJSON).toHaveBeenCalledWith(
      '{"name":"test"}',
      [0],
      null,
    );
    expect(content).toBeInstanceOf(GeneratedContent);
    expect(content._nativeContent).toBe("mock-content-pointer");
  });

  it("fromJson throws when C returns null pointer", () => {
    mockFns.FMGeneratedContentCreateFromJSON.mockReturnValueOnce(null);
    expect(() => GeneratedContent.fromJson("bad")).toThrow();
  });

  it("isComplete returns boolean from FFI", () => {
    const content = new GeneratedContent(mockPointer("mock-content"));
    expect(content.isComplete).toBe(true);
    expect(mockFns.FMGeneratedContentIsComplete).toHaveBeenCalledWith("mock-content");

    mockFns.FMGeneratedContentIsComplete.mockReturnValueOnce(false);
    expect(content.isComplete).toBe(false);
  });

  it("toJson returns JSON string via decodeAndFreeString", () => {
    const content = new GeneratedContent(mockPointer("mock-content"));
    const json = content.toJson();
    expect(mockFns.FMGeneratedContentGetJSONString).toHaveBeenCalledWith("mock-content");
    expect(json).toBe('{"name":"test"}');
  });

  it('toJson returns "{}" when decodeAndFreeString returns null', () => {
    mockFns.FMGeneratedContentGetJSONString.mockReturnValueOnce(null);
    const content = new GeneratedContent(mockPointer("mock-content"));
    const json = content.toJson();
    expect(json).toBe("{}");
  });

  it("toObject parses JSON and caches result", () => {
    const content = new GeneratedContent(mockPointer("mock-content"));
    const obj1 = content.toObject();
    expect(obj1).toEqual({ name: "test" });

    // Second call should use cached value — no additional FFI call
    const callsBefore = mockFns.FMGeneratedContentGetJSONString.mock.calls.length;
    const obj2 = content.toObject();
    expect(obj2).toBe(obj1); // same reference
    expect(mockFns.FMGeneratedContentGetJSONString.mock.calls.length).toBe(callsBefore);
  });

  it("value returns parsed JSON value when FFI returns non-null", () => {
    mockFns.FMGeneratedContentGetPropertyValue.mockReturnValueOnce("mock-value-pointer");
    mockDecodeAndFreeString.mockReturnValueOnce('"hello"');
    const content = new GeneratedContent(mockPointer("mock-content"));
    const result = content.value<string>("greeting");
    expect(result).toBe("hello");
    expect(mockFns.FMGeneratedContentGetPropertyValue).toHaveBeenCalledWith(
      "mock-content",
      "greeting",
      null,
      null,
    );
  });

  it("value returns raw string when JSON.parse fails", () => {
    mockFns.FMGeneratedContentGetPropertyValue.mockReturnValueOnce("mock-value-pointer");
    mockDecodeAndFreeString.mockReturnValueOnce("not-valid-json");
    const content = new GeneratedContent(mockPointer("mock-content"));
    const result = content.value<string>("field");
    expect(result).toBe("not-valid-json");
  });

  it("value falls back to toObject when FFI returns null", () => {
    // FMGeneratedContentGetPropertyValue returns null by default
    // decodeAndFreeString(null) returns null per the mock setup
    // toJson's decodeAndFreeString call returns the default '{"name":"test"}'
    const content = new GeneratedContent(mockPointer("mock-content"));
    const result = content.value<string>("name");
    expect(result).toBe("test");
  });

  it("value throws when property not found anywhere", () => {
    const content = new GeneratedContent(mockPointer("mock-content"));
    expect(() => content.value("nonexistent")).toThrow(
      "Property 'nonexistent' not found in generated content",
    );
  });

  describe("dispose", () => {
    it("releases native pointer", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      content.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-content");
      expect(content._nativeContent).toBeNull();
    });

    it("is safe to call twice", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      content.dispose();
      content.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    });

    it("Symbol.dispose delegates to dispose", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      content[Symbol.dispose]();
      expect(content._nativeContent).toBeNull();
    });

    it("toJson throws after dispose", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      content.dispose();
      expect(() => content.toJson()).toThrow("GeneratedContent has been disposed");
    });

    it("isComplete throws after dispose", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      content.dispose();
      expect(() => content.isComplete).toThrow("GeneratedContent has been disposed");
    });

    it("value throws after dispose", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      content.dispose();
      expect(() => content.value("name")).toThrow("GeneratedContent has been disposed");
    });

    it("toObject returns cached value after dispose", () => {
      const content = new GeneratedContent(mockPointer("mock-content"));
      const obj = content.toObject(); // caches the result
      content.dispose();
      // toObject uses cache, does not hit native
      expect(content.toObject()).toBe(obj);
    });
  });
});

describe("generable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a schema with scalar properties", () => {
    const def = generable("Person", {
      name: { type: "string", description: "Full name" },
      age: { type: "integer" },
      active: { type: "boolean" },
    });

    expect(def.schema).toBeInstanceOf(GenerationSchema);
    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledWith("Person", null);
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledTimes(3);
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "name",
      "Full name",
      "string",
      false,
    );
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "age",
      null,
      "integer",
      false,
    );
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "active",
      null,
      "boolean",
      false,
    );
  });

  it("passes description to GenerationSchema", () => {
    generable("Thing", { x: { type: "string" } }, "A thing");
    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledWith("Thing", "A thing");
  });

  it("handles optional fields", () => {
    generable("Opt", {
      required: { type: "string" },
      maybe: { type: "string", optional: true },
    });

    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "required",
      null,
      "string",
      false,
    );
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "maybe",
      null,
      "string",
      true,
    );
  });

  it("applies guides to properties", () => {
    generable("Guided", {
      score: { type: "integer", guides: [GenerationGuide.range(1, 10)] },
      tag: { type: "string", guides: [GenerationGuide.anyOf(["a", "b"])] },
    });

    expect(mockFns.FMGenerationSchemaPropertyAddRangeGuide).toHaveBeenCalledWith(
      "mock-prop-pointer",
      1,
      10,
      false,
    );
    expect(mockFns.FMGenerationSchemaPropertyAddAnyOfGuide).toHaveBeenCalledWith(
      "mock-prop-pointer",
      ["a", "b"],
      2,
      false,
    );
  });

  it("creates reference schemas for nested objects", () => {
    generable("Outer", {
      inner: {
        type: "object",
        properties: {
          value: { type: "string" },
        },
      },
    });

    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledTimes(2);
    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledWith("Outer", null);
    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledWith("inner", null);
    expect(mockFns.FMGenerationSchemaAddReferenceSchema).toHaveBeenCalled();
  });

  it("creates reference schemas for arrays of objects", () => {
    generable("List", {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
        },
      },
    });

    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledTimes(2);
    expect(mockFns.FMGenerationSchemaAddReferenceSchema).toHaveBeenCalled();
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "items",
      null,
      "array<items>",
      false,
    );
  });

  it("handles scalar array properties without reference schema", () => {
    generable("Tags", {
      tags: { type: "array", items: { type: "string" } },
    });

    expect(mockFns.FMGenerationSchemaCreate).toHaveBeenCalledTimes(1);
    expect(mockFns.FMGenerationSchemaAddReferenceSchema).not.toHaveBeenCalled();
    expect(mockFns.FMGenerationSchemaPropertyCreate).toHaveBeenCalledWith(
      "tags",
      null,
      "array<string>",
      false,
    );
  });

  it("parse delegates to GeneratedContent.toObject()", () => {
    const def = generable("Simple", {
      name: { type: "string" },
    });

    const content = new GeneratedContent(mockPointer("mock-content"));
    const result = def.parse(content);
    expect(result).toEqual({ name: "test" });
  });

  it("type inference produces correct types", () => {
    const def = generable("Movie", {
      title: { type: "string" },
      year: { type: "integer" },
      rating: { type: "number" },
      seen: { type: "boolean" },
      note: { type: "string", optional: true },
    });

    const content = new GeneratedContent(mockPointer("mock-content"));
    const movie = def.parse(content);

    // These accesses must type-check (compile-time verification)
    const _title: string = movie.title;
    const _year: number = movie.year;
    const _rating: number = movie.rating;
    const _seen: boolean = movie.seen;
    const _note: string | undefined = movie.note;

    void _title;
    void _year;
    void _rating;
    void _seen;
    void _note;

    expect(movie).toBeDefined();
  });
});
