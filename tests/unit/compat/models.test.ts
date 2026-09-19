import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  compatModelName,
  mapReasoningEffort,
  warnOnUnknownModel,
  SYSTEM_MODEL,
  PCC_MODEL,
} from "../../../src/compat/models.js";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("compatModelName", () => {
  it("selects PCC only by its exact name", () => {
    expect(compatModelName(PCC_MODEL)).toBe(PCC_MODEL);
    expect(compatModelName(SYSTEM_MODEL)).toBe(SYSTEM_MODEL);
    expect(compatModelName(undefined)).toBe(SYSTEM_MODEL);
    expect(compatModelName("gpt-4o")).toBe(SYSTEM_MODEL);
  });
});

describe("warnOnUnknownModel", () => {
  it("accepts both model names and an omitted model", () => {
    warnOnUnknownModel(SYSTEM_MODEL);
    warnOnUnknownModel(PCC_MODEL);
    warnOnUnknownModel(undefined);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns on anything else", () => {
    warnOnUnknownModel("gpt-4o");
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("gpt-4o"));
  });
});

describe("mapReasoningEffort", () => {
  it.each([
    ["minimal", "light"],
    ["low", "light"],
    ["medium", "moderate"],
    ["high", "deep"],
    ["xhigh", "deep"],
  ])("maps %s to %s for PCC", (effort, level) => {
    expect(mapReasoningEffort(effort, PCC_MODEL, "reasoning_effort")).toBe(level);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("leaves the level unset for none", () => {
    expect(mapReasoningEffort("none", PCC_MODEL, "reasoning_effort")).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("ignores a missing effort", () => {
    expect(mapReasoningEffort(null, SYSTEM_MODEL, "reasoning_effort")).toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns and ignores an effort for the on-device model", () => {
    expect(mapReasoningEffort("high", SYSTEM_MODEL, "reasoning_effort")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(PCC_MODEL));
  });

  it("doesn't read Object.prototype members as efforts", () => {
    expect(mapReasoningEffort("constructor", PCC_MODEL, "reasoning.effort")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"constructor"'));
  });

  it("warns and ignores an unknown effort", () => {
    expect(mapReasoningEffort("extreme", PCC_MODEL, "reasoning.effort")).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"extreme"'));
  });
});
