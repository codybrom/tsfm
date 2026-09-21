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
import { FoundationModelsError, PrivateCloudComputeNetworkError } from "../../src/errors.js";

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

  it.each(["not json", "[]", "null", '"text"'])(
    "throws a typed error for quota JSON %s",
    (json) => {
      mockFns.FMPrivateCloudComputeLanguageModelGetQuotaUsageJSON.mockReturnValueOnce(json);
      expect(() => new PrivateCloudComputeLanguageModel().quotaUsage).toThrow(
        FoundationModelsError,
      );
    },
  );

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

  it("disposes once, and refuses use afterwards", async () => {
    const model = new PrivateCloudComputeLanguageModel();
    model.dispose();
    model.dispose();
    expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    expect(() => model.isAvailable()).toThrow(/disposed/);
    await expect(model.supportedLanguages()).rejects.toThrow(/disposed/);
    await expect(model.supportsLocale("en-US")).rejects.toThrow(/disposed/);
  });

  describe("supportedLanguages", () => {
    const langs = (text: string | null, status = 0) => started({ status, text }) as never;

    it("resolves the parsed native JSON and releases the request", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelGetSupportedLanguages.mockReturnValueOnce(
        langs('["en-US","es-ES"]'),
      );
      await expect(new PrivateCloudComputeLanguageModel().supportedLanguages()).resolves.toEqual([
        "en-US",
        "es-ES",
      ]);
      expect(mockFns.FMPrivateCloudComputeLanguageModelGetSupportedLanguages).toHaveBeenCalledWith(
        "mock-pcc-pointer",
      );
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-request");
    });

    it("resolves empty when the native side has nothing", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelGetSupportedLanguages.mockReturnValueOnce(
        langs(null),
      );
      await expect(new PrivateCloudComputeLanguageModel().supportedLanguages()).resolves.toEqual(
        [],
      );
    });

    it("rejects on malformed JSON rather than reading it as no languages", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelGetSupportedLanguages.mockReturnValueOnce(
        langs("{oops"),
      );
      await expect(
        new PrivateCloudComputeLanguageModel().supportedLanguages(),
      ).rejects.toBeInstanceOf(FoundationModelsError);
    });

    it("rejects with a mapped error when the native side fails", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelGetSupportedLanguages.mockReturnValueOnce(
        langs("offline", 16),
      );
      await expect(
        new PrivateCloudComputeLanguageModel().supportedLanguages(),
      ).rejects.toBeInstanceOf(PrivateCloudComputeNetworkError);
    });
  });

  describe("supportsLocale", () => {
    const answer = (count: number, status = 0, message: string | null = null) =>
      started({ status, count, message }) as never;

    it("resolves the native answer and passes the locale", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelSupportsLocale.mockReturnValueOnce(answer(0));
      await expect(new PrivateCloudComputeLanguageModel().supportsLocale("xx_XX")).resolves.toBe(
        false,
      );
      expect(mockFns.FMPrivateCloudComputeLanguageModelSupportsLocale).toHaveBeenCalledWith(
        "mock-pcc-pointer",
        "xx_XX",
      );
    });

    it("resolves true when the count is 1", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelSupportsLocale.mockReturnValueOnce(answer(1));
      await expect(new PrivateCloudComputeLanguageModel().supportsLocale("en-US")).resolves.toBe(
        true,
      );
    });

    it("defaults to the host's current locale", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelSupportsLocale.mockReturnValueOnce(answer(1));
      await new PrivateCloudComputeLanguageModel().supportsLocale();
      expect(mockFns.FMPrivateCloudComputeLanguageModelSupportsLocale).toHaveBeenCalledWith(
        "mock-pcc-pointer",
        Intl.DateTimeFormat().resolvedOptions().locale,
      );
    });

    it("rejects with a mapped error when the native side fails", async () => {
      mockFns.FMPrivateCloudComputeLanguageModelSupportsLocale.mockReturnValueOnce(
        answer(0, 16, "offline"),
      );
      await expect(
        new PrivateCloudComputeLanguageModel().supportsLocale("en-US"),
      ).rejects.toBeInstanceOf(PrivateCloudComputeNetworkError);
    });
  });
});
