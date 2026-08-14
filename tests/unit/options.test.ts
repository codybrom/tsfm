import { describe, it, expect } from "vitest";
import { SamplingMode, serializeOptions } from "../../src/options.js";

describe("SamplingMode", () => {
  describe("greedy", () => {
    it("returns type greedy", () => {
      const mode = SamplingMode.greedy();
      expect(mode.type).toBe("greedy");
    });
  });

  describe("random", () => {
    it("returns type random with no options", () => {
      const mode = SamplingMode.random();
      expect(mode.type).toBe("random");
    });

    it("accepts top parameter", () => {
      const mode = SamplingMode.random({ top: 50 });
      expect(mode.top).toBe(50);
    });

    it("accepts probabilityThreshold parameter", () => {
      const mode = SamplingMode.random({ probabilityThreshold: 0.9 });
      expect(mode.probabilityThreshold).toBe(0.9);
    });

    it("accepts seed parameter", () => {
      const mode = SamplingMode.random({ seed: 42 });
      expect(mode.seed).toBe(42);
    });

    it("throws when both top and probabilityThreshold are set", () => {
      expect(() => SamplingMode.random({ top: 50, probabilityThreshold: 0.9 })).toThrow(
        "Cannot specify both",
      );
    });

    it("throws when top is not positive", () => {
      expect(() => SamplingMode.random({ top: 0 })).toThrow("positive integer");
      expect(() => SamplingMode.random({ top: -1 })).toThrow("positive integer");
    });

    it("throws when probabilityThreshold is out of range", () => {
      expect(() => SamplingMode.random({ probabilityThreshold: -0.1 })).toThrow(
        "between 0.0 and 1.0",
      );
      expect(() => SamplingMode.random({ probabilityThreshold: 1.1 })).toThrow(
        "between 0.0 and 1.0",
      );
    });

    it("allows boundary values for probabilityThreshold", () => {
      expect(SamplingMode.random({ probabilityThreshold: 0.0 }).probabilityThreshold).toBe(0.0);
      expect(SamplingMode.random({ probabilityThreshold: 1.0 }).probabilityThreshold).toBe(1.0);
    });
  });
});

describe("serializeOptions", () => {
  it("returns null for undefined options", () => {
    expect(serializeOptions(undefined)).toBeNull();
  });

  it("serializes temperature", () => {
    const result = JSON.parse(serializeOptions({ temperature: 0.7 })!);
    expect(result.temperature).toBe(0.7);
  });

  it("serializes maximumResponseTokens as maximum_response_tokens", () => {
    const result = JSON.parse(serializeOptions({ maximumResponseTokens: 100 })!);
    expect(result.maximum_response_tokens).toBe(100);
    expect(result.maximumResponseTokens).toBeUndefined();
  });

  it("serializes greedy sampling", () => {
    const result = JSON.parse(serializeOptions({ sampling: SamplingMode.greedy() })!);
    expect(result.sampling).toEqual({ mode: "greedy" });
  });

  it("serializes random sampling with top as top_k", () => {
    const result = JSON.parse(serializeOptions({ sampling: SamplingMode.random({ top: 50 }) })!);
    expect(result.sampling).toEqual({ mode: "random", top_k: 50 });
  });

  it("serializes random sampling with probabilityThreshold as top_p", () => {
    const result = JSON.parse(
      serializeOptions({ sampling: SamplingMode.random({ probabilityThreshold: 0.9 }) })!,
    );
    expect(result.sampling).toEqual({ mode: "random", top_p: 0.9 });
  });

  it("serializes random sampling with seed", () => {
    const result = JSON.parse(serializeOptions({ sampling: SamplingMode.random({ seed: 42 }) })!);
    expect(result.sampling).toEqual({ mode: "random", seed: 42 });
  });

  it("throws when temperature is negative", () => {
    expect(() => serializeOptions({ temperature: -0.1 })).toThrow("non-negative");
  });

  it("allows zero temperature", () => {
    const result = JSON.parse(serializeOptions({ temperature: 0 })!);
    expect(result.temperature).toBe(0);
  });

  it("throws when maximumResponseTokens is not a positive integer", () => {
    expect(() => serializeOptions({ maximumResponseTokens: 0 })).toThrow("positive integer");
    expect(() => serializeOptions({ maximumResponseTokens: -1 })).toThrow("positive integer");
    expect(() => serializeOptions({ maximumResponseTokens: 1.5 })).toThrow("positive integer");
  });

  it("serializes all options together", () => {
    const result = JSON.parse(
      serializeOptions({
        temperature: 0.8,
        maximumResponseTokens: 200,
        sampling: SamplingMode.random({ top: 40, seed: 7 }),
      })!,
    );
    expect(result.temperature).toBe(0.8);
    expect(result.maximum_response_tokens).toBe(200);
    expect(result.sampling).toEqual({ mode: "random", top_k: 40, seed: 7 });
  });
});
