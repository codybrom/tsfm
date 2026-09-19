import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

vi.hoisted(() => {
  globalThis.FinalizationRegistry = class MockFinalizationRegistry {
    register() {}
    unregister() {}
  } as unknown as typeof FinalizationRegistry;
});

const { lastCallback } = vi.hoisted(() => ({
  lastCallback: { cb: null as ((...args: unknown[]) => void) | null },
}));

vi.mock("koffi", () => ({
  default: {
    register: vi.fn((cb: (...args: unknown[]) => void) => {
      lastCallback.cb = cb;
      return "mock-cb-pointer";
    }),
    pointer: vi.fn(() => "mock-proto-pointer"),
  },
}));

const mockFns = createMockFunctions();
const mockDecodeAndFreeString = vi.fn();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeAndFreeString: (...args: unknown[]) => mockDecodeAndFreeString(...args),
  unregisterCallback: vi.fn(),
  TokenCountCallbackProto: "mock-token-proto",
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
    mockFns.FMPrivateCloudComputeLanguageModelIsAvailable.mockImplementationOnce(
      (_m: unknown, out: number[]) => ((out[0] = code), false),
    );
    expect(new PrivateCloudComputeLanguageModel().isAvailable()).toEqual({
      available: false,
      reason,
    });
  });

  it("reports availability", () => {
    mockFns.FMPrivateCloudComputeLanguageModelIsAvailable.mockImplementationOnce(() => true);
    expect(new PrivateCloudComputeLanguageModel().isAvailable()).toEqual({ available: true });
  });

  it("waitUntilAvailable returns at once when the entitlement is missing", async () => {
    const result = await new PrivateCloudComputeLanguageModel().waitUntilAvailable(10_000);
    expect(result.reason).toBe(PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING);
    expect(mockFns.FMPrivateCloudComputeLanguageModelIsAvailable).toHaveBeenCalledTimes(1);
  });

  it("parses the quota", () => {
    mockDecodeAndFreeString.mockReturnValueOnce(
      '{"limitReached":false,"approachingLimit":true,"resetDate":"2026-09-20T00:00:00Z"}',
    );
    expect(new PrivateCloudComputeLanguageModel().quotaUsage).toEqual({
      limitReached: false,
      approachingLimit: true,
      resetDate: new Date("2026-09-20T00:00:00Z"),
    });
  });

  it("resolves the context size from the callback", async () => {
    const promise = new PrivateCloudComputeLanguageModel().contextSize();
    lastCallback.cb?.(0, 32768, null);
    await expect(promise).resolves.toBe(32768);
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-task");
  });

  it("rejects the context size with a mapped error", async () => {
    const promise = new PrivateCloudComputeLanguageModel().contextSize();
    lastCallback.cb?.(16, 0, "offline");
    await expect(promise).rejects.toBeInstanceOf(PrivateCloudComputeNetworkError);
  });

  it("disposes once, and refuses use afterwards", () => {
    const model = new PrivateCloudComputeLanguageModel();
    model.dispose();
    model.dispose();
    expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    expect(() => model.isAvailable()).toThrow(/disposed/);
  });
});
