import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const { capturedRegistryCallback } = vi.hoisted(() => {
  let cb: ((pointer: unknown) => void) | null = null;
  const OriginalFR = globalThis.FinalizationRegistry;
  globalThis.FinalizationRegistry = class MockFinalizationRegistry {
    constructor(callback: (pointer: unknown) => void) {
      cb = callback;
    }
    register() {}
    unregister() {}
  } as unknown as typeof FinalizationRegistry;
  return {
    capturedRegistryCallback: () => cb,
    OriginalFR,
  };
});

const { lastTokenCallback } = vi.hoisted(() => {
  const holder: { cb: ((...args: unknown[]) => void) | null } = { cb: null };
  return { lastTokenCallback: holder };
});

vi.mock("koffi", () => ({
  default: {
    register: vi.fn((cb: (...args: unknown[]) => void, _proto: unknown) => {
      lastTokenCallback.cb = cb;
      return "mock-cb-pointer";
    }),
    unregister: vi.fn(),
    as: vi.fn(() => "mock-arr-pointer"),
    pointer: vi.fn(() => "mock-proto-pointer"),
    proto: vi.fn(() => "mock-proto"),
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
      mockFns.FMSystemLanguageModelIsAvailable.mockImplementationOnce(
        (_pointer: unknown, reasonOut: number[]) => {
          reasonOut[0] = SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE;
          return false;
        },
      );
      const model = new SystemLanguageModel();
      const result = model.isAvailable();
      expect(result.available).toBe(false);
      expect(result.reason).toBe(SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE);
    });

    it("returns UNKNOWN for unrecognized reason codes", () => {
      mockFns.FMSystemLanguageModelIsAvailable.mockImplementationOnce(
        (_pointer: unknown, reasonOut: number[]) => {
          reasonOut[0] = 999;
          return false;
        },
      );
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
      mockFns.FMSystemLanguageModelIsAvailable.mockImplementation(
        (_pointer: unknown, reasonOut: number[]) => {
          reasonOut[0] = SystemLanguageModelUnavailableReason.DEVICE_NOT_ELIGIBLE;
          return false;
        },
      );
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable(1000);
      expect(result.available).toBe(false);
      expect(mockFns.FMSystemLanguageModelIsAvailable).toHaveBeenCalledTimes(1);
    });

    it("times out when MODEL_NOT_READY persists past deadline", async () => {
      mockFns.FMSystemLanguageModelIsAvailable.mockImplementation(
        (_pointer: unknown, reasonOut: number[]) => {
          reasonOut[0] = SystemLanguageModelUnavailableReason.MODEL_NOT_READY;
          return false;
        },
      );
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable(50, 10);
      expect(result.available).toBe(false);
      expect(result.reason).toBe(SystemLanguageModelUnavailableReason.MODEL_NOT_READY);
    });

    it("retries on MODEL_NOT_READY then succeeds", async () => {
      let callCount = 0;
      mockFns.FMSystemLanguageModelIsAvailable.mockImplementation(
        (_pointer: unknown, reasonOut: number[]) => {
          callCount++;
          if (callCount < 3) {
            reasonOut[0] = SystemLanguageModelUnavailableReason.MODEL_NOT_READY;
            return false;
          }
          reasonOut[0] = 0;
          return true;
        },
      );
      const model = new SystemLanguageModel();
      const result = await model.waitUntilAvailable(5000, 10);
      expect(result.available).toBe(true);
      expect(callCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe("FinalizationRegistry cleanup", () => {
    it("releases pointer when GC callback fires", () => {
      const cleanup = capturedRegistryCallback();
      expect(cleanup).toBeTypeOf("function");
      cleanup!("leaked-model-pointer");
      expect(mockFns.FMRelease).toHaveBeenCalledWith("leaked-model-pointer");
    });

    it("swallows errors in GC callback", () => {
      mockFns.FMRelease.mockImplementationOnce(() => {
        throw new Error("already released");
      });
      const cleanup = capturedRegistryCallback();
      // Should not throw
      expect(() => cleanup!("bad-pointer")).not.toThrow();
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
      mockDecodeAndFreeString.mockReturnValueOnce('["en-US","es-ES"]');
      const model = new SystemLanguageModel();
      expect(model.supportedLanguages).toEqual(["en-US", "es-ES"]);
      expect(mockFns.FMSystemLanguageModelGetSupportedLanguages).toHaveBeenCalledWith(
        "mock-model-pointer",
      );
    });

    it("returns empty array when pointer is null", () => {
      mockDecodeAndFreeString.mockReturnValueOnce(null);
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
  it("resolves the count the callback reports", async () => {
    const model = new SystemLanguageModel();
    const promise = model.tokenCount({ instructions: "Be brief." });
    queueMicrotask(() => lastTokenCallback.cb?.(0, 42, null, null));
    await expect(promise).resolves.toBe(42);
  });

  it("passes instructions straight to the C API", async () => {
    const model = new SystemLanguageModel();
    const promise = model.tokenCount({ instructions: "Be brief." });
    queueMicrotask(() => lastTokenCallback.cb?.(0, 7, null, null));
    await promise;
    expect(mockFns.FMSystemLanguageModelTokenCountForInstructions).toHaveBeenCalledWith(
      "mock-model-pointer",
      "Be brief.",
      null,
      "mock-cb-pointer",
    );
  });

  it("rejects with the description the callback reports", async () => {
    const model = new SystemLanguageModel();
    const promise = model.tokenCount({ instructions: "x" });
    queueMicrotask(() => lastTokenCallback.cb?.(5, 0, "model unavailable", null));
    await expect(promise).rejects.toThrow(/model unavailable/);
  });

  it("releases the task handle once the count arrives", async () => {
    const model = new SystemLanguageModel();
    const promise = model.tokenCount({ instructions: "x" });
    queueMicrotask(() => lastTokenCallback.cb?.(0, 1, null, null));
    await promise;
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-token-task");
  });

  it("builds and releases a composed prompt for a text prompt", async () => {
    const model = new SystemLanguageModel();
    const promise = model.tokenCount({ prompt: "Hello" });
    queueMicrotask(() => lastTokenCallback.cb?.(0, 3, null, null));
    await promise;
    expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith("mock-composed-prompt", "Hello");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
  });
});

describe("model information", () => {
  it("reads the variant name", () => {
    mockDecodeAndFreeString.mockReturnValueOnce("AFM 3 Core Advanced");
    expect(new SystemLanguageModel().variant).toBe("AFM 3 Core Advanced");
  });

  it("reads the capabilities", () => {
    mockDecodeAndFreeString.mockReturnValueOnce('["vision","toolCalling","guidedGeneration"]');
    expect(new SystemLanguageModel().capabilities).toEqual([
      "vision",
      "toolCalling",
      "guidedGeneration",
    ]);
  });
});
