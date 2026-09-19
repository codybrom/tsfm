import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stringParams, checkStringArgs } from "../../src/bindings.js";

const root = path.resolve(import.meta.dirname, "../..");
const bindings = readFileSync(path.join(root, "src/bindings.ts"), "utf8");
const header = [
  "native/bridge/Sources/FoundationModelsCBindings/include/FoundationModels.h",
  "native/extensions/TsfmExtensions.h",
]
  .map((file) => readFileSync(path.join(root, file), "utf8"))
  .join("\n");

/** Every koffi signature declared in bindings.ts. */
const signatures = [...bindings.matchAll(/"([^"]*\bFM\w+\([^)]*\)[^"]*)"/g)].map((m) => m[1]);

/** The C header's parameter list for a function. */
function headerParams(name: string): string[] {
  const match = new RegExp(`\\b${name}\\s*\\(([^;]*)\\)\\s*;`).exec(header);
  if (!match) throw new Error(`${name} isn't declared in the C headers`);
  return match[1].split(",").map((p) => p.trim());
}

describe("string parameters in the koffi signatures", () => {
  it("found the signatures", () => {
    expect(signatures.length).toBeGreaterThan(40);
  });

  // A nullable_str lets null through to native code, so it must match a
  // _Nullable parameter; a plain str must match a _Nonnull one.
  it.each(signatures.filter((sig) => stringParams(sig).length > 0))(
    "match the C header's nullability: %s",
    (sig) => {
      const name = /\b(FM\w+)\s*\(/.exec(sig)![1];
      const params = headerParams(name);
      for (const param of stringParams(sig)) {
        const c = params[param.index];
        expect(c, `${name} parameter ${param.index}`).toMatch(/char\s*\*/);
        if (param.kind === "nullable_str") {
          expect(c, `${name}.${param.name} should be _Nullable`).toMatch(/_Nullable/);
        } else {
          expect(c, `${name}.${param.name} should be _Nonnull`).toMatch(/\*\s*_Nonnull/);
        }
      }
    },
  );

  it("declares every const char * input parameter in the header as a string", () => {
    for (const sig of signatures) {
      const name = /\b(FM\w+)\s*\(/.exec(sig)![1];
      const declared = new Set(stringParams(sig).map((p) => p.index));
      headerParams(name).forEach((c, index) => {
        if (/const char\s*\*/.test(c) && !/_Out_|\*\s*\w*\s*\*/.test(c)) {
          expect(declared.has(index), `${name} parameter ${index} (${c})`).toBe(true);
        }
      });
    }
  });
});

describe("stringParams", () => {
  it("reads str, nullable_str and str * parameters", () => {
    expect(
      stringParams("void f(void * a, str name, nullable_str label, str * values, int n)"),
    ).toEqual([
      { index: 1, name: "name", kind: "str" },
      { index: 2, name: "label", kind: "nullable_str" },
      { index: 3, name: "values", kind: "str_array" },
    ]);
  });
});

describe("checkStringArgs", () => {
  const params = stringParams("void f(str name, nullable_str label, str * values)");

  it("accepts strings, and null for a nullable parameter", () => {
    expect(() => checkStringArgs("f", params, ["a", null, ["x"]])).not.toThrow();
    expect(() => checkStringArgs("f", params, ["a", undefined, []])).not.toThrow();
  });

  it.each([
    [[42, null, []], /"name" \(f\), got number/],
    [[null, null, []], /"name" \(f\), got null/],
    [[undefined, null, []], /"name" \(f\), got undefined/],
    [["a", 42, []], /"label" \(f\), got number/],
    [["a", null, [1]], /"values" \(f\), got an array containing number at index 0/],
    [["a", null, ["x", , "y"]], /"values" \(f\), got an array containing undefined at index 1/],
    [["a", null, new Array(2)], /"values" \(f\), got an array containing undefined at index 0/],
    [["a", null, "x"], /array of strings for "values" \(f\), got string/],
  ])("rejects %j", (args, message) => {
    expect(() => checkStringArgs("f", params, args)).toThrow(TypeError);
    expect(() => checkStringArgs("f", params, args)).toThrow(message);
  });
});
