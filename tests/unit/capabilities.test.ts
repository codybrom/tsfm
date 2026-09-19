import { describe, it, expect } from "vitest";
import { parseCapabilities } from "../../src/capabilities.js";

describe("parseCapabilities", () => {
  it("parses known capability names", () => {
    expect(parseCapabilities('["vision","toolCalling","guidedGeneration","reasoning"]')).toEqual([
      "vision",
      "toolCalling",
      "guidedGeneration",
      "reasoning",
    ]);
  });

  it("drops names it doesn't know", () => {
    expect(parseCapabilities('["vision","telepathy",3]')).toEqual(["vision"]);
  });

  it("returns [] when nothing is reported", () => {
    expect(parseCapabilities(null)).toEqual([]);
  });

  it("throws on malformed JSON instead of reporting no capabilities", () => {
    expect(() => parseCapabilities("{nope")).toThrow(/capabilities/);
    expect(() => parseCapabilities('{"vision":true}')).toThrow(/capabilities/);
  });
});
