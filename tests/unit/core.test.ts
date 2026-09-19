import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions, started } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
}));

import {
  SystemLanguageModel,
  SystemLanguageModelUseCase,
  SystemLanguageModelGuardrails,
  SystemLanguageModelUnavailableReason,
} from "../../src/core.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SystemLanguageModel", () => {
  it("creates with default options", () => {
    const model = new SystemLanguageModel();
    expect(mockFns.FMSystemLanguageModelCreate).toHaveBeenCalledWith(
      SystemLanguageModelUseCase.GENERAL,
      SystemLanguageModelGuardrails.DEFAULT,
    );
    expect(model._nativeModel).toBe("mock-model-pointer");
  });

  it("creates with custom use case and guardrails", () => {
    new SystemLanguageModel({
      useCase: SystemLanguageModelUseCase.CONTENT_TAGGING,
      guardrails: SystemLanguageModelGuardrails.PERMISSIVE_CONTENT_TRANSFORMATIONS,
    });
    expect(mockFns.FMSystemLanguageModelCreate).toHaveBeenCalledWith(1, 1);
  });

  it("throws when C returns null pointer", () => {
    mockFns.FMSystemLanguageModelCreate.mockReturnValueOnce(null);
    expect(() => new SystemLanguageModel()).toThrow("Failed to create SystemLanguageModel");
  });

  describe("isAvailable", () => {
    it("returns available: true when C reports available", () => {
      const model = new SystemLanguageModel();
      const result = model.isAvailable();
      expect(result).toEqual({ available: true });
    });

    it("returns available: false with reason when C reports unavailable", () => {
      mockFns.FMSystemLanguageModelIsAvailable.mockReturnValueOnce({
        available: false,
        reason: SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE,
      });
      const model = new SystemLanguageModel();
      const result = model.isAvailable();
      expect(result.available).toBe(false);
      expect(result.reason).toBe(SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE);
    });

    it("returns UNKNOWN for unrecognized reason codes", () => {
      mockFns.FMSystemLanguageModelIsAvailable.mockReturnValueOnce({
        available: false,
        reason: 999,
      });
      const model = new SystemLanguageModel();
      const result = model.isAvailable();
      expect(result.reason).toBe(SystemLanguageModelUnavailableReason.UNKNOWN);
    });
  });

  describe("waitUntilAvailable", () => {
    it("resolves immediately when available", async () => {
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable();
      expect(result.available).toBe(true);
    });

    it("returns immediately for non-transient failures", async () => {
      mockFns.FMSystemLanguageModelIsAvailable.mockReturnValue({
        available: false,
        reason: SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE,
      });
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable(1000);
      expect(result.available).toBe(false);
      expect(mockFns.FMSystemLanguageModelIsAvailable).toHaveBeenCalledTimes(1);
    });

    it("times out when MODEL_NOT_READY persists past deadline", async () => {
      mockFns.FMSystemLanguageModelIsAvailable.mockReturnValue({
        available: false,
        reason: SystemLanguageModelUnavailableReason.MODEL_NOT_READY,
      });
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable(50, 10);
      expect(result.available).toBe(false);
      expect(result.reason).toBe(SystemLanguageModelUnavailableReason.MODEL_NOT_READY);
    });

    it("retries on MODEL_NOT_READY then succeeds", async () => {
      let callCount = 0;
      mockFns.FMSystemLanguageModelIsAvailable.mockImplementation(() => {
        callCount++;
        return callCount < 3
          ? { available: false, reason: SystemLanguageModelUnavailableReason.MODEL_NOT_READY }
          : { available: true, reason: null };
      });
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable(5000, 10);
      expect(result.available).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("after dispose", () => {
    it("refuses use instead of passing a released handle to native code", () => {
      const model = new SystemLanguageModel();
      model.dispose();
      expect(() => model.isAvailable()).toThrow(/disposed/);
      expect(() => model.contextSize).toThrow(/disposed/);
      expect(() => model.tokenCount({ instructions: "x" })).toThrow(/disposed/);
      expect(mockFns.FMSystemLanguageModelIsAvailable).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("releases the C pointer", () => {
      const model = new SystemLanguageModel();
      model.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-model-pointer");
      expect(model._nativeModel).toBeNull();
    });

    it("is safe to call twice", () => {
      const model = new SystemLanguageModel();
      model.dispose();
      model.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    });
  });

  describe("Symbol.dispose", () => {
    it("delegates to dispose()", () => {
      const model = new SystemLanguageModel();
      model[Symbol.dispose]();
      expect(model._nativeModel).toBeNull();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-model-pointer");
    });
  });

  describe("contextSize", () => {
    it("returns the value from the C API", () => {
      const model = new SystemLanguageModel();
      expect(model.contextSize).toBe(4096);
      expect(mockFns.FMSystemLanguageModelGetContextSize).toHaveBeenCalledWith(
        "mock-model-pointer",
      );
    });
  });

  describe("supportedLanguages", () => {
    it("parses JSON array from the C API", () => {
      mockFns.FMSystemLanguageModelGetSupportedLanguages.mockReturnValueOnce('["en-US","es-ES"]');
      const model = new SystemLanguageModel();
      expect(model.supportedLanguages).toEqual(["en-US", "es-ES"]);
      expect(mockFns.FMSystemLanguageModelGetSupportedLanguages).toHaveBeenCalledWith(
        "mock-model-pointer",
      );
    });

    it("returns empty array when pointer is null", () => {
      mockFns.FMSystemLanguageModelGetSupportedLanguages.mockReturnValueOnce(null);
      const model = new SystemLanguageModel();
      expect(model.supportedLanguages).toEqual([]);
    });
  });

  describe("supportsLocale", () => {
    it("passes locale identifier to C API and returns result", () => {
      const model = new SystemLanguageModel();
      expect(model.supportsLocale("en_US")).toBe(true);
      expect(mockFns.FMSystemLanguageModelSupportsLocale).toHaveBeenCalledWith(
        "mock-model-pointer",
        "en_US",
      );
    });

    it("returns false when C API reports unsupported", () => {
      mockFns.FMSystemLanguageModelSupportsLocale.mockReturnValueOnce(false);
      const model = new SystemLanguageModel();
      expect(model.supportsLocale("xx_XX")).toBe(false);
    });
  });
});

describe("SystemLanguageModel.tokenCount", () => {
  const counts = (count: number, status = 0, message: string | null = null) =>
    started({ status, count, message }) as never;

  it("resolves the count the native side reports", async () => {
    mockFns.FMSystemLanguageModelTokenCountForInstructions.mockReturnValueOnce(counts(42));
    await expect(new SystemLanguageModel().tokenCount({ instructions: "Be brief." })).resolves.toBe(
      42,
    );
  });

  it("passes instructions straight to the native side", async () => {
    mockFns.FMSystemLanguageModelTokenCountForInstructions.mockReturnValueOnce(counts(7));
    await new SystemLanguageModel().tokenCount({ instructions: "Be brief." });
    expect(mockFns.FMSystemLanguageModelTokenCountForInstructions).toHaveBeenCalledWith(
      "mock-model-pointer",
      "Be brief.",
    );
  });

  it("rejects with the description the native side reports", async () => {
    mockFns.FMSystemLanguageModelTokenCountForInstructions.mockReturnValueOnce(
      counts(0, 5, "model unavailable"),
    );
    await expect(new SystemLanguageModel().tokenCount({ instructions: "x" })).rejects.toThrow(
      /model unavailable/,
    );
  });

  it("passes the tools' handles", async () => {
    mockFns.FMSystemLanguageModelTokenCountForTools.mockReturnValueOnce(counts(9));
    const tool = { _nativeTool: "mock-tool-pointer" } as never;
    await new SystemLanguageModel().tokenCount({ tools: [tool] });
    expect(mockFns.FMSystemLanguageModelTokenCountForTools).toHaveBeenCalledWith(
      "mock-model-pointer",
      ["mock-tool-pointer"],
    );
  });

  it("builds and releases a composed prompt for a text prompt", async () => {
    mockFns.FMSystemLanguageModelTokenCountForPrompt.mockReturnValueOnce(counts(3));
    await new SystemLanguageModel().tokenCount({ prompt: "Hello" });
    expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith("mock-composed-prompt", "Hello");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
  });
});

describe("model information", () => {
  it("reads the variant name", () => {
    mockFns.FMSystemLanguageModelGetVariantName.mockReturnValueOnce("AFM 3 Core Advanced");
    expect(new SystemLanguageModel().variant).toBe("AFM 3 Core Advanced");
  });

  it("reads the capabilities", () => {
    mockFns.FMSystemLanguageModelGetCapabilitiesJSON.mockReturnValueOnce(
      '["vision","toolCalling","guidedGeneration"]',
    );
    expect(new SystemLanguageModel().capabilities).toEqual([
      "vision",
      "toolCalling",
      "guidedGeneration",
    ]);
  });
});
