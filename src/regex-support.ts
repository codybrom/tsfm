/**
 * What the on-device model's regex guides accept, checked before a request so an
 * unsupported pattern fails fast with a clear message instead of an opaque
 * UnsupportedGuide error, a generic failure, or (for `(?:…)`) a runaway response
 * that fills the context window.
 *
 * Measured on macOS 27.0 (AFM 3 Core Advanced) by generating with each construct:
 *
 * - Supported: literals, `.`, `\d` `\w` `\s`, escaped punctuation (`\.` `\(` `\[`
 *   `\^` `\$` `\{` …), capturing groups (nested, quantified), `|`, and the
 *   quantifiers `*` `+` `?` `{m}` `{m,n}`.
 * - Rejected: character classes `[…]`, anchors `^` `$`, other escapes (`\D` `\W`
 *   `\S` `\b` `\n` `\t` `\p{…}` `\x41` `\\`, backreferences), `(?…)` groups, and
 *   lazy or possessive quantifiers (`+?` `*+` `{2,3}?`).
 */

const SUPPORTED_LETTER_ESCAPES = new Set(["d", "w", "s"]);

/**
 * The first construct in `pattern` the on-device model doesn't support, described
 * with an alternative, or null if the whole pattern is supported.
 */
export function findUnsupportedRegexConstruct(pattern: string): string | null {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];

    if (c === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) return "a trailing backslash";
      if (/[A-Za-z]/.test(next)) {
        if (!SUPPORTED_LETTER_ESCAPES.has(next)) {
          return `the escape \\${next} (only \\d, \\w and \\s are supported)`;
        }
      } else if (/[0-9]/.test(next)) {
        return `the backreference \\${next}`;
      } else if (next === "\\") {
        return "an escaped backslash \\\\";
      }
      i++; // Skip the escaped character.
      continue;
    }

    if (c === "[") {
      return "a character class [...]; use \\d, \\w or \\s, or alternation such as (a|b|c)";
    }
    if (c === "^" || c === "$") {
      return `the anchor ${c}; patterns already match the whole value, so leave it out`;
    }
    if (c === "(" && pattern[i + 1] === "?") {
      return "a (?...) group; use a plain group (...) instead";
    }

    const isQuantifier = c === "*" || c === "+" || c === "?" || c === "}";
    if (isQuantifier && (pattern[i + 1] === "?" || pattern[i + 1] === "+")) {
      // `?` itself can be a quantifier ("a?"); only a quantifier directly followed
      // by ? or + makes it lazy or possessive.
      return `the lazy or possessive quantifier ${c}${pattern[i + 1]}`;
    }
  }
  return null;
}

/** Keywords whose value is a single subschema. */
const SUBSCHEMA_KEYWORDS = [
  "items",
  "additionalProperties",
  "unevaluatedProperties",
  "additionalItems",
  "contains",
  "propertyNames",
  "not",
  "if",
  "then",
  "else",
];
/** Keywords whose value is an array of subschemas. */
const SUBSCHEMA_ARRAY_KEYWORDS = ["anyOf", "oneOf", "allOf", "prefixItems"];
/** Keywords whose value maps names to subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = [
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
];

/**
 * Every `pattern` constraint in a JSON schema, with the path to it. Only
 * keywords that hold subschemas are followed, so a "pattern" key inside
 * instance data (examples, default, const, enum values) isn't mistaken for one.
 */
export function collectSchemaPatterns(
  schema: unknown,
  path = "$",
): Array<{ path: string; pattern: string }> {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) return [];
  const node = schema as Record<string, unknown>;
  const found: Array<{ path: string; pattern: string }> = [];
  if (typeof node.pattern === "string") found.push({ path, pattern: node.pattern });

  for (const key of SUBSCHEMA_KEYWORDS) {
    const value = node[key];
    if (Array.isArray(value)) {
      // Draft-4 tuple form: "items": [schema, schema].
      value.forEach((v, i) => found.push(...collectSchemaPatterns(v, `${path}.${key}[${i}]`)));
    } else {
      found.push(...collectSchemaPatterns(value, `${path}.${key}`));
    }
  }
  for (const key of SUBSCHEMA_ARRAY_KEYWORDS) {
    const value = node[key];
    if (Array.isArray(value)) {
      value.forEach((v, i) => found.push(...collectSchemaPatterns(v, `${path}.${key}[${i}]`)));
    }
  }
  for (const key of SUBSCHEMA_MAP_KEYWORDS) {
    const value = node[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [name, sub] of Object.entries(value)) {
        found.push(...collectSchemaPatterns(sub, `${path}.${key}.${name}`));
      }
    }
  }
  return found;
}
