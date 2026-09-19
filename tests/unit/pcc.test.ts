import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions, started } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
}));

import {
  PrivateCloudComputeLanguageModel,
  PrivateCloudComputeUnavailableReason,
} from "../../src/pcc.js";
import { PrivateCloudComputeNetworkError } from "../../src/errors.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PrivateCloudComputeLanguageModel", () => {
  it("creates the native model", () => {
    const model = new PrivateCloudComputeLanguageModel();
    expect(mockFns.FMPrivateCloudComputeLanguageModelCreate).toHaveBeenCalledTimes(1);
    expect(model._nativeModel).toBe("mock-pcc-pointer");
  });

  it.each([
    [1, PrivateCloudComputeUnavailableReason.DEVICE_NOT_ELIGIBLE],
    [2, PrivateCloudComputeUnavailableReason.SYSTEM_NOT_READY],
    [3, PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING],
    [42, PrivateCloudComputeUnavailableReason.UNKNOWN],
  ])("maps unavailable reason %i", (code, reason) => {
    mockFns.FMPrivateCloudComputeLanguageModelIsAvailable.mockReturnValueOnce({
      available: false,
      reason: code,
    });
    expect(new PrivateCloudComputeLanguageModel().isAvailable()).toEqual({
      available: false,
      reason,
    });
  });

  it("reports availability", () => {
    mockFns.FMPrivateCloudComputeLanguageModelIsAvailable.mockReturnValueOnce({
      available: true,
      reason: null,
    });
    expect(new PrivateCloudComputeLanguageModel().isAvailable()).toEqual({ available: true });
  });

  it("waitUntilAvailable returns at once when the entitlement is missing", async () => {
    const result = await new PrivateCloudComputeLanguageModel().waitUntilAvailable(10_000);
    expect(result.reason).toBe(PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING);
    expect(mockFns.FMPrivateCloudComputeLanguageModelIsAvailable).toHaveBeenCalledTimes(1);
  });

  it("parses the quota", () => {
    mockFns.FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON.mockReturnValueOnce(
      '{"limitReached":false,"approachingLimit":true,"resetDate":"2026-09-20T00:00:00Z"}',
    );
    expect(new PrivateCloudComputeLanguageModel().quotaUsage).toEqual({
      limitReached: false,
      approachingLimit: true,
      resetDate: new Date("2026-09-20T00:00:00Z"),
    });
  });

  it("resolves the context size", async () => {
    mockFns.FMPrivateCloudComputeLanguageModelGetContextSize.mockReturnValueOnce(
      started({ status: 0, count: 32768, message: null }) as never,
    );
    await expect(new PrivateCloudComputeLanguageModel().contextSize()).resolves.toBe(32768);
  });

  it("rejects the context size with a mapped error", async () => {
    mockFns.FMPrivateCloudComputeLanguageModelGetContextSize.mockReturnValueOnce(
      started({ status: 16, count: 0, message: "offline" }) as never,
    );
    await expect(new PrivateCloudComputeLanguageModel().contextSize()).rejects.toBeInstanceOf(
      PrivateCloudComputeNetworkError,
    );
  });

  it("disposes once, and refuses use afterwards", () => {
    const model = new PrivateCloudComputeLanguageModel();
    model.dispose();
    model.dispose();
    expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    expect(() => model.isAvailable()).toThrow(/disposed/);
  });
});
