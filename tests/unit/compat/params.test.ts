import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapParams, ownParams } from "../../../src/compat/params.js";
import { compatStatusFor, throwAsCompatError } from "../../../src/compat/utils.js";
import {
  RateLimitedError,
  GuardrailViolationError,
  PrivateCloudComputeQuotaExceededError,
  PrivateCloudComputeUnavailableError,
  PrivateCloudComputeNetworkError,
  PrivateCloudComputeEntitlementError,
} from "../../../src/errors.js";
import type { ChatCompletionCreateParams } from "../../../src/compat/types.js";
import { SamplingMode } from "../../../src/options.js";

describe("mapParams", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty options when no params provided", () => {
    const result = mapParams({});
    expect(result).toEqual({});
  });

  it("maps temperature to GenerationOptions.temperature", () => {
    const result = mapParams({ temperature: 0.7 });
    expect(result.temperature).toBe(0.7);
  });

  it("maps max_tokens to maximumResponseTokens", () => {
    const result = mapParams({ max_tokens: 512 });
    expect(result.maximumResponseTokens).toBe(512);
  });

  it("maps max_completion_tokens to maximumResponseTokens", () => {
    const result = mapParams({ max_completion_tokens: 256 });
    expect(result.maximumResponseTokens).toBe(256);
  });

  it("prefers max_completion_tokens over max_tokens when both present", () => {
    const result = mapParams({ max_tokens: 512, max_completion_tokens: 256 });
    expect(result.maximumResponseTokens).toBe(256);
  });

  it("maps top_p to SamplingMode.random with probabilityThreshold", () => {
    const result = mapParams({ top_p: 0.9 });
    expect(result.sampling).toEqual(SamplingMode.random({ probabilityThreshold: 0.9 }));
  });

  it("maps seed to SamplingMode.random with seed", () => {
    const result = mapParams({ seed: 42 });
    expect(result.sampling).toEqual(SamplingMode.random({ seed: 42 }));
  });

  it("combines top_p and seed into a single SamplingMode.random", () => {
    const result = mapParams({ top_p: 0.8, seed: 7 });
    expect(result.sampling).toEqual(SamplingMode.random({ probabilityThreshold: 0.8, seed: 7 }));
  });

  it("sets temperature independently from sampling mode", () => {
    const result = mapParams({ temperature: 0.5, top_p: 0.9 });
    expect(result.temperature).toBe(0.5);
    expect(result.sampling).toEqual(SamplingMode.random({ probabilityThreshold: 0.9 }));
  });

  it("warns for each unsupported param that is non-null", () => {
    mapParams({ n: 2, stop: "STOP", logprobs: true });
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it("warns when model is not SystemLanguageModel", () => {
    mapParams({ model: "gpt-4o" });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("gpt-4o"));
  });

  it("does not warn when model is SystemLanguageModel", () => {
    mapParams({ model: "SystemLanguageModel" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not warn when model is omitted", () => {
    mapParams({});
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("treats null values as not provided", () => {
    const result = mapParams({
      temperature: null,
      max_tokens: null,
      max_completion_tokens: null,
      top_p: null,
      seed: null,
    });
    expect(result).toEqual({});
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not warn for null unsupported params", () => {
    mapParams({ n: null, stop: null });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns when both max_tokens and max_completion_tokens are set", () => {
    const result = mapParams({ max_tokens: 512, max_completion_tokens: 256 });
    expect(result.maximumResponseTokens).toBe(256);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Both "max_tokens" and "max_completion_tokens"'),
    );
  });

  it("warns when tool_choice is set to a non-auto value", () => {
    mapParams({ tool_choice: "required" });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"tool_choice" value "required"'),
    );
  });

  it("warns when tool_choice is set to an object", () => {
    mapParams({ tool_choice: { type: "function", function: { name: "test" } } });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('"tool_choice" value "object"'),
    );
  });

  it("does not warn when tool_choice is auto", () => {
    mapParams({ tool_choice: "auto" });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("does not warn when tool_choice is not set", () => {
    mapParams({});
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("maps reasoning_effort to reasoningLevel for Private Cloud Compute", () => {
    const result = mapParams({
      model: "PrivateCloudComputeLanguageModel",
      reasoning_effort: "medium",
    });
    expect(result.reasoningLevel).toBe("moderate");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns and ignores reasoning_effort for the on-device model", () => {
    const result = mapParams({ reasoning_effort: "high" });
    expect(result.reasoningLevel).toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("reasoning_effort"));
  });

  it("accepts stream_options.include_usage without warning", () => {
    mapParams({ stream_options: { include_usage: true } });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("warns on other stream_options keys", () => {
    mapParams({
      stream_options: { include_usage: true, include_obfuscation: true } as never,
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("stream_options.include_obfuscation"),
    );
  });

  it.each([
    ["a string", "yes", /"stream_options" must be an object; got string/],
    ["a number", 3, /"stream_options" must be an object; got number/],
    ["an array", ["include_usage"], /"stream_options" must be an object; got an array/],
  ])("warns when stream_options is %s", (_name, value, message) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mapParams({ stream_options: value } as never);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(message));
    warn.mockRestore();
  });

  it.each([
    ["undefined", undefined],
    ["absent", "absent"],
  ])("says nothing when include_usage is %s", (_name, value) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const streamOptions = value === "absent" ? {} : { include_usage: value };
    mapParams({ stream_options: streamOptions } as never);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("warns when include_usage isn't a boolean", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mapParams({ stream_options: { include_usage: "true" } } as never);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/"stream_options.include_usage" must be a boolean; got string/),
    );
    warn.mockRestore();
  });

  it("ignores a stream option supplied by the prototype", () => {
    const polluted = Object.create({ nonsense: true }) as Record<string, unknown>;
    polluted.include_usage = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mapParams({ stream_options: polluted } as never);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("copies params without a prototype, so a missing key can't be inherited", () => {
    // A spread copy would still inherit from Object.prototype: the copy must
    // have none, or a polluted key reads through on every request.
    const copy = ownParams({ model: "SystemLanguageModel" }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(copy)).toBeNull();
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto.response_format = { type: "json_object" };
    try {
      expect(ownParams({} as Record<string, unknown>).response_format).toBeUndefined();
    } finally {
      delete proto.response_format;
    }
  });

  it("takes the model from the params' own properties, not the prototype", () => {
    // A polluted prototype must not pick Private Cloud Compute for a caller.
    const polluted = Object.create({
      model: "PrivateCloudComputeLanguageModel",
      reasoning_effort: "high",
    }) as Partial<ChatCompletionCreateParams>;
    polluted.temperature = 0.5;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const options = mapParams(polluted);
    expect(options.reasoningLevel).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it.each([
    ["PrivateCloudComputeQuotaExceededError", new PrivateCloudComputeQuotaExceededError(), 429],
    ["PrivateCloudComputeUnavailableError", new PrivateCloudComputeUnavailableError(), 503],
    ["PrivateCloudComputeNetworkError", new PrivateCloudComputeNetworkError(), 503],
    ["PrivateCloudComputeEntitlementError", new PrivateCloudComputeEntitlementError(), 403],
    ["RateLimitedError", new RateLimitedError(), 429],
  ])("gives %s an HTTP status, so a proxy doesn't answer 500", (_name, err, status) => {
    expect(compatStatusFor(err)).toBe(status);
    expect(() => throwAsCompatError(err)).toThrow(
      expect.objectContaining({ name: "CompatError", status }),
    );
  });

  it("leaves an error with no HTTP counterpart alone", () => {
    expect(compatStatusFor(new GuardrailViolationError())).toBeNull();
    expect(() => throwAsCompatError(new GuardrailViolationError())).not.toThrow();
  });
});
