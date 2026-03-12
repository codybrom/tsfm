import type { JsonSchema, JsonObject } from "../schema.js";

/**
 * Reorder JSON keys to match the property order defined in a JSON schema.
 * Other AI APIs return keys in schema-defined order; Apple returns them in
 * generation order. This normalizes the output for compatibility.
 */
export function reorderJson(json: string, schema: JsonSchema): string {
  try {
    const obj = JSON.parse(json);
    return JSON.stringify(orderKeys(obj, schema));
  } catch {
    return json;
  }
}

export function orderKeys(value: JsonObject[string], schema: JsonSchema): JsonObject[string] {
  if (value == null || typeof value !== "object") return value;

  // Handle arrays: reorder keys inside each element using schema.items
  if (Array.isArray(value)) {
    const itemSchema = schema.items as JsonSchema | undefined;
    if (itemSchema && typeof itemSchema === "object" && !Array.isArray(itemSchema)) {
      return value.map((el) => orderKeys(el, itemSchema)) as JsonObject[];
    }
    return value;
  }

  const props = schema.properties as Record<string, JsonSchema> | undefined;
  if (!props) return value;

  const obj = value as JsonObject;
  const ordered: JsonObject = {};

  // First, add keys in schema property order
  for (const key of Object.keys(props)) {
    if (key in obj) {
      ordered[key] = orderKeys(obj[key], props[key]);
    }
  }
  // Then any extra keys not in schema (shouldn't happen with strict schemas)
  for (const key of Object.keys(obj)) {
    if (!(key in ordered)) {
      ordered[key] = obj[key];
    }
  }
  return ordered;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class CompatError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CompatError";
    this.status = status;
  }
}
