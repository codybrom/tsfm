import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
}));

vi.mock("../../src/tool.js", () => ({
  Tool: class MockTool {
    _nativeTool = "mock-tool-pointer";
    _budgets = new Set();
    _register() {}
  },
}));

import { _setRuntimeMacOSMajorForTesting, hasMacOS27 } from "../../src/os.js";
import { LanguageModelSession } from "../../src/session.js";
import {
  PrivateCloudComputeLanguageModel,
  PrivateCloudComputeUnavailableReason,
} from "../../src/pcc.js";
import { UnsupportedCapabilityError, statusToError } from "../../src/errors.js";

beforeEach(() => {
  vi.clearAllMocks();
  _setRuntimeMacOSMajorForTesting(26);
});

afterAll(() => {
  _setRuntimeMacOSMajorForTesting(27);
});

/** Awaits `run` and returns what it threw. */
async function thrown(run: () => unknown): Promise<unknown> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("expected an error");
}

describe("on macOS 26", () => {
  it("knows it isn't macOS 27", () => {
    expect(hasMacOS27()).toBe(false);
  });

  describe("toolCallingMode", () => {
    it.each(["required", "disallowed"] as const)(
      "rejects %s before the request, naming macOS 27",
      async (mode) => {
        const session = new LanguageModelSession();
        const err = await thrown(() =>
          session.respond("Hi", { options: { toolCallingMode: mode } }),
        );
        expect(err).toBeInstanceOf(UnsupportedCapabilityError);
        expect((err as UnsupportedCapabilityError).requiredMacOS).toBe(27);
        expect((err as Error).message).toMatch(
          new RegExp(`toolCallingMode "${mode}" requires macOS 27.*this Mac runs macOS 26`),
        );
        expect(mockFns.FMLanguageModelSessionRespond).not.toHaveBeenCalled();
      },
    );

    it("rejects it on streams too", async () => {
      const session = new LanguageModelSession();
      const err = await thrown(async () => {
        for await (const _ of session.streamResponse("Hi", {
          options: { toolCallingMode: "required" },
        })) {
          // Consume.
        }
      });
      expect(err).toBeInstanceOf(UnsupportedCapabilityError);
      expect(mockFns.FMLanguageModelSessionStreamResponse).not.toHaveBeenCalled();
    });

    it('allows "allowed", which is the default behavior', () => {
      const session = new LanguageModelSession();
      void session.respond("Hi", { options: { toolCallingMode: "allowed" } }).catch(() => {});
      return vi.waitFor(() => expect(mockFns.FMLanguageModelSessionRespond).toHaveBeenCalled());
    });
  });

  describe("Private Cloud Compute", () => {
    it("constructs without a native model and reports REQUIRES_NEWER_OS", () => {
      const pcc = new PrivateCloudComputeLanguageModel();
      expect(mockFns.FMPrivateCloudComputeLanguageModelCreate).not.toHaveBeenCalled();
      expect(pcc.isAvailable()).toEqual({
        available: false,
        reason: PrivateCloudComputeUnavailableReason.REQUIRES_NEWER_OS,
      });
    });

    it("waitUntilAvailable returns at once", async () => {
      const pcc = new PrivateCloudComputeLanguageModel();
      expect(await pcc.waitUntilAvailable(60_000)).toEqual({
        available: false,
        reason: PrivateCloudComputeUnavailableReason.REQUIRES_NEWER_OS,
      });
    });

    it("returns null for capabilities and quota", () => {
      const pcc = new PrivateCloudComputeLanguageModel();
      expect(pcc.capabilities).toBeNull();
      expect(pcc.quotaUsage).toBeNull();
    });

    it("rejects contextSize() with a typed reason", async () => {
      const err = await thrown(() => new PrivateCloudComputeLanguageModel().contextSize());
      expect(err).toBeInstanceOf(UnsupportedCapabilityError);
      expect((err as UnsupportedCapabilityError).requiredMacOS).toBe(27);
    });

    it("refuses to start a session, naming macOS 27 rather than disposal", () => {
      const pcc = new PrivateCloudComputeLanguageModel();
      expect(() => new LanguageModelSession({ model: pcc })).toThrow(UnsupportedCapabilityError);
      expect(() => new LanguageModelSession({ model: pcc })).toThrow(
        /Private Cloud Compute requires macOS 27/,
      );
      expect(
        mockFns.FMLanguageModelSessionCreateFromPrivateCloudComputeModel,
      ).not.toHaveBeenCalled();
    });

    it("still reports disposal after dispose()", () => {
      const pcc = new PrivateCloudComputeLanguageModel();
      pcc.dispose();
      expect(() => pcc.isAvailable()).toThrow(/disposed/);
    });
  });

  it("reports null usage, not zeros", () => {
    // The bridge returns no usage JSON on macOS 26 (the mocks do the same).
    const session = new LanguageModelSession();
    expect(session.usage).toBeNull();
  });

  it("doesn't apply the macOS 27 model's regex table", async () => {
    const session = new LanguageModelSession();
    void session
      .respondWithJsonSchema("Make one up.", {
        type: "object",
        properties: { v: { type: "string", pattern: "[a-z]+" } },
      })
      .catch(() => {});
    await vi.waitFor(() =>
      expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).toHaveBeenCalled(),
    );
  });
});

describe("Private Cloud Compute creation on macOS 27", () => {
  it("throws a real error if the native model can't be created", () => {
    _setRuntimeMacOSMajorForTesting(27);
    mockFns.FMPrivateCloudComputeLanguageModelCreate.mockReturnValueOnce(null as never);
    expect(() => new PrivateCloudComputeLanguageModel()).toThrow(
      "Failed to create PrivateCloudComputeLanguageModel",
    );
  });

  it("reads NULL as an older macOS only when the version is unknown", () => {
    _setRuntimeMacOSMajorForTesting(null);
    mockFns.FMPrivateCloudComputeLanguageModelCreate.mockReturnValueOnce(null as never);
    expect(new PrivateCloudComputeLanguageModel().isAvailable()).toEqual({
      available: false,
      reason: PrivateCloudComputeUnavailableReason.REQUIRES_NEWER_OS,
    });
  });
});

describe("bridge errors for macOS 27 features", () => {
  it("carry requiredMacOS from the bridge's message", () => {
    const err = statusToError(13, "reasoningLevel requires macOS 27 or later.");
    expect(err).toBeInstanceOf(UnsupportedCapabilityError);
    expect((err as UnsupportedCapabilityError).requiredMacOS).toBe(27);
  });

  it("leave requiredMacOS unset for other unsupported capabilities", () => {
    const err = statusToError(13, "The model can't reason.");
    expect((err as UnsupportedCapabilityError).requiredMacOS).toBeUndefined();
  });
});
