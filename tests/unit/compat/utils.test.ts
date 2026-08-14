import { describe, it, expect, vi } from "vitest";
import { reorderJson, orderKeys, nowSeconds, CompatError } from "../../../src/compat/utils.js";
import type { JsonSchema } from "../../../src/schema.js";

// ---------------------------------------------------------------------------
// reorderJson
// ---------------------------------------------------------------------------

describe("reorderJson", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "number" },
      email: { type: "string" },
    },
  };

  it("reorders keys to match schema property order", () => {
    const json = JSON.stringify({ email: "a@b.com", name: "Alice", age: 30 });
    const result = JSON.parse(reorderJson(json, schema));
    expect(Object.keys(result)).toEqual(["name", "age", "email"]);
  });

  it("returns original string on invalid JSON", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const invalid = "not-json{";
    expect(reorderJson(invalid, schema)).toBe(invalid);
    expect(warnSpy).toHaveBeenCalledOnce();
    warnSpy.mockRestore();
  });

  it("preserves values when reordering", () => {
    const json = JSON.stringify({ age: 25, name: "Bob" });
    const result = JSON.parse(reorderJson(json, schema));
    expect(result).toEqual({ name: "Bob", age: 25 });
  });

  it("handles extra keys not in schema", () => {
    const json = JSON.stringify({ extra: true, name: "C" });
    const result = JSON.parse(reorderJson(json, schema));
    expect(Object.keys(result)).toEqual(["name", "extra"]);
  });
});

// ---------------------------------------------------------------------------
// orderKeys
// ---------------------------------------------------------------------------

describe("orderKeys", () => {
  it("returns primitives unchanged", () => {
    expect(orderKeys("hello", {})).toBe("hello");
    expect(orderKeys(42, {})).toBe(42);
    expect(orderKeys(null, {})).toBeNull();
    expect(orderKeys(undefined, {})).toBeUndefined();
  });

  it("reorders nested objects via schema properties", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        b: { type: "string" },
        a: { type: "string" },
      },
    };
    const result = orderKeys({ a: 1, b: 2 }, schema);
    expect(Object.keys(result as Record<string, unknown>)).toEqual(["b", "a"]);
  });

  it("reorders array elements using items schema", () => {
    const schema: JsonSchema = {
      type: "array",
      items: {
        type: "object",
        properties: {
          z: { type: "string" },
          a: { type: "string" },
        },
      },
    };
    const input = [
      { a: 1, z: 2 },
      { a: 3, z: 4 },
    ];
    const result = orderKeys(input, schema) as Array<Record<string, unknown>>;
    expect(Object.keys(result[0])).toEqual(["z", "a"]);
    expect(Object.keys(result[1])).toEqual(["z", "a"]);
  });

  it("returns arrays unchanged when no items schema", () => {
    const input = [1, 2, 3];
    expect(orderKeys(input, { type: "array" })).toEqual([1, 2, 3]);
  });

  it("returns objects unchanged when schema has no properties", () => {
    const input = { c: 1, a: 2 };
    const result = orderKeys(input, { type: "object" });
    expect(result).toEqual({ c: 1, a: 2 });
  });
});

// ---------------------------------------------------------------------------
// nowSeconds
// ---------------------------------------------------------------------------

describe("nowSeconds", () => {
  it("returns current time in seconds (integer)", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = nowSeconds();
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
    expect(Number.isInteger(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CompatError
// ---------------------------------------------------------------------------

describe("CompatError", () => {
  it("sets name and status", () => {
    const err = new CompatError("bad request", 400);
    expect(err.name).toBe("CompatError");
    expect(err.message).toBe("bad request");
    expect(err.status).toBe(400);
    expect(err).toBeInstanceOf(Error);
  });
});
