import { describe, it, expect } from "vitest";
import { findUnsupportedRegexConstruct, collectSchemaPatterns } from "../../src/regex-support.js";

// Mirrors what the macOS 27 on-device model accepted when generating with each
// pattern. If the model's support changes, update both lists together.
const SUPPORTED = [
  "abc",
  "a.c",
  String.raw`\d{3}`,
  String.raw`\w+`,
  String.raw`a\sb`,
  "(yes|no)",
  "(ab)+",
  "((a|b)c)+",
  "ab*",
  "ab+",
  "ab?",
  "a{2,4}",
  String.raw`\d{4}-\d{2}`,
  String.raw`a\.b`,
  String.raw`a\-b`,
  String.raw`\(a\)`,
  String.raw`\[a\]`,
  String.raw`a\^b`,
  String.raw`\$\d+`,
  String.raw`\{a\}`,
  String.raw`\w+@\w+\.com`,
];

const UNSUPPORTED: Array<[string, RegExp]> = [
  ["[abc]", /character class/],
  ["[a-z]+", /character class/],
  ["[0-9]{2}", /character class/],
  ["[^a]", /character class/],
  [String.raw`[\d]`, /character class/],
  ["^abc$", /anchor \^/],
  ["abc$", /anchor \$/],
  [String.raw`\D`, /escape \\D/],
  [String.raw`\W`, /escape \\W/],
  [String.raw`a\Sb`, /escape \\S/],
  [String.raw`\bab`, /escape \\b/],
  [String.raw`a\nb`, /escape \\n/],
  [String.raw`a\tb`, /escape \\t/],
  [String.raw`\p{L}+`, /escape \\p/],
  [String.raw`\x41`, /escape \\x/],
  [String.raw`a\\b`, /escaped backslash/],
  [String.raw`(a)\1`, /backreference/],
  ["(?:ab)+", /\(\?\.\.\.\) group/],
  ["a(?=b)", /\(\?\.\.\.\) group/],
  ["a+?", /lazy or possessive quantifier \+\?/],
  ["a++", /lazy or possessive quantifier \+\+/],
  ["ab??", /lazy or possessive quantifier \?\?/],
  ["a{2,3}?", /lazy or possessive quantifier \}\?/],
  ["abc\\", /trailing backslash/],
];

describe("findUnsupportedRegexConstruct", () => {
  it.each(SUPPORTED)("accepts %s", (pattern) => {
    expect(findUnsupportedRegexConstruct(pattern)).toBeNull();
  });

  it.each(UNSUPPORTED)("rejects %s", (pattern, reason) => {
    expect(findUnsupportedRegexConstruct(pattern)).toMatch(reason);
  });

  it("suggests alternatives", () => {
    expect(findUnsupportedRegexConstruct("[0-9]")).toMatch(/\\d.*alternation/);
    expect(findUnsupportedRegexConstruct("^a")).toMatch(/leave it out/);
  });
});

describe("collectSchemaPatterns", () => {
  it("finds patterns at any depth, with their paths", () => {
    const schema = {
      type: "object",
      properties: {
        code: { type: "string", pattern: String.raw`\d+` },
        tags: { type: "array", items: { type: "string", pattern: "[a-z]+" } },
      },
      $defs: { Inner: { properties: { id: { type: "string", pattern: "x" } } } },
    };
    expect(collectSchemaPatterns(schema)).toEqual([
      { path: "$.properties.code", pattern: String.raw`\d+` },
      { path: "$.properties.tags.items", pattern: "[a-z]+" },
      { path: "$.$defs.Inner.properties.id", pattern: "x" },
    ]);
  });

  it("ignores pattern keys inside instance data", () => {
    const schema = {
      type: "object",
      examples: [{ pattern: "[0-9]" }],
      default: { pattern: "[a-z]" },
      const: { pattern: "^x" },
      enum: [{ pattern: "(?:a)" }],
      properties: { v: { type: "string", examples: [{ pattern: "[0-9]" }] } },
    };
    expect(collectSchemaPatterns(schema)).toEqual([]);
  });

  it("follows combinators, tuple items and conditionals", () => {
    const schema = {
      anyOf: [{ pattern: "a" }, { properties: { x: { pattern: "b" } } }],
      items: [{ pattern: "c" }],
      if: { pattern: "d" },
      not: { pattern: "e" },
    };
    expect(
      collectSchemaPatterns(schema)
        .map((p) => p.pattern)
        .sort(),
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("ignores a property that happens to be named pattern", () => {
    expect(collectSchemaPatterns({ properties: { pattern: { type: "string" } } })).toEqual([]);
  });
});
