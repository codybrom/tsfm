import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createMockFunctions, started } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
}));

import {
  SystemOneClient,
  TypeSafeClient,
  choice,
  noul,
  score,
  type ChoiceResponse,
  type NoulResponse,
  type RequestOptions,
  type ScoreResponse,
  type TypeSafeClientConfig,
  type Usage,
} from "../../src/system-one.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockFns.FMSystemLanguageModelGetVariantName.mockReturnValue("AFM Test");
});

function respondWith(json: string): void {
  mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockReturnValueOnce(
    started({ status: 0, content: "mock-content", message: null }) as never,
  );
  mockFns.FMGeneratedContentGetJSONString.mockReturnValueOnce(json);
}

describe("System One question builders", () => {
  it("builds Jev-shaped questions and preserves inferred labels", () => {
    const yes = noul("Is this urgent?");
    const route = choice("Where should this go?", {
      billing: "Money and refunds",
      technical: null,
    });
    const urgency = score("How urgent?", ["Can wait", "Today", "Now"]);

    expect(yes).toEqual({ type: "noul", instructions: "Is this urgent?", criteria: undefined });
    expect(route.type).toBe("choice");
    expect(urgency.type).toBe("score");
    expectTypeOf<ChoiceResponse<typeof route.criteria>["choice"]>().toEqualTypeOf<
      "billing" | "technical"
    >();
    expectTypeOf<Usage>().toEqualTypeOf<{
      readonly input_tokens: number;
      readonly output_tokens: number;
    }>();
    expectTypeOf<RequestOptions>().toHaveProperty("generationOptions");
    expectTypeOf<TypeSafeClientConfig>().toHaveProperty("model");
  });

  it("rejects obviously malformed builder inputs immediately", () => {
    expect(() => choice("Pick", [] as never)).toThrow("must be an object");
    expect(() => score("Rate", {} as never)).toThrow("must be an array");
  });

  it("exports TypeSafeClient as a compatibility name", () => {
    expect(TypeSafeClient).toBe(SystemOneClient);
  });
});

describe("SystemOneClient", () => {
  it("evaluates mixed questions in one structured request", async () => {
    respondWith('{"q0":0.8,"q1":[0.2,0.7,0.1],"q2":[0.1,0.3,0.6]}');
    mockFns.FMLanguageModelSessionGetUsageJSON.mockReturnValueOnce(
      '{"input":{"totalTokens":5,"cachedTokens":1},"output":{"totalTokens":2,"reasoningTokens":0}}',
    ).mockReturnValueOnce(
      '{"input":{"totalTokens":15,"cachedTokens":3},"output":{"totalTokens":6,"reasoningTokens":0}}',
    );

    const client = new SystemOneClient();
    const result = await client.systemOne({
      state: { ticket: "Charged twice; refund me today." },
      questions: {
        urgent: noul("Does this need attention today?"),
        department: choice("Which team owns this?", {
          sales: null,
          billing: "Charges and refunds",
          technical: "Product failures",
        }),
        frustration: score("How frustrated is the customer?", ["Calm", "Upset", "Angry"]),
      },
    });

    expect(result).toEqual({
      model: "AFM Test",
      answers: {
        urgent: { type: "noul", noul: 0.8 },
        department: {
          type: "choice",
          choice: "billing",
          confidence: 0.55,
          probabilities: { sales: 0.2, billing: 0.7, technical: 0.1 },
        },
        frustration: {
          type: "score",
          score: 1.5,
          confidence: 0.4,
          legend: { 0: "Calm", 1: "Upset", 2: "Angry" },
          probabilities: { 0: 0.1, 1: 0.3, 2: 0.6 },
        },
      },
      usage: { input_tokens: 10, output_tokens: 4 },
    });

    expectTypeOf(result.answers.urgent).toEqualTypeOf<NoulResponse>();
    expectTypeOf(result.answers.department).toMatchTypeOf<
      ChoiceResponse<{ sales: null; billing: string; technical: string }>
    >();
    expectTypeOf(result.answers.frustration).toMatchTypeOf<ScoreResponse>();

    expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).toHaveBeenCalledTimes(1);
    const schemaJson = mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mock.calls[0][2];
    const schema = JSON.parse(schemaJson as string) as {
      properties: Record<string, { type: string; minItems?: number; maxItems?: number }>;
      required: string[];
    };
    expect(schema.required).toEqual(["q0", "q1", "q2"]);
    expect(schema.properties.q0.type).toBe("number");
    expect(schema.properties.q1).toMatchObject({ type: "array", minItems: 3, maxItems: 3 });

    const prompt = mockFns.FMComposedPromptAddText.mock.calls[0][1];
    expect(prompt).toContain("Charged twice; refund me today.");
    expect(prompt).toContain('"output":"q1"');
    expect(prompt).toContain('"label":"billing"');
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-content");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
    client.dispose();
  });

  it("normalizes distributions and derives the winner and score", async () => {
    respondWith('{"q0":[0.2,0.2],"q1":[0,0,0]}');
    const client = new SystemOneClient();
    const result = await client.systemOne({
      state: "Ambiguous",
      questions: {
        route: choice("Pick one", { first: null, second: null }),
        level: score("Rate it", ["Low", "Medium", "High"]),
      },
    });

    expect(result.answers.route).toEqual({
      type: "choice",
      choice: "first",
      confidence: 0,
      probabilities: { first: 0.5, second: 0.5 },
    });
    expect(result.answers.level.score).toBeCloseTo(1);
    expect(result.answers.level.confidence).toBe(0);
    expect(Object.values(result.answers.level.probabilities)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(result.usage).toBeNull();
    client.dispose();
  });

  it("keeps hostile question and label keys as ordinary own properties", async () => {
    respondWith('{"q0":[0.9,0.1]}');
    const questions = JSON.parse(
      '{"__proto__":{"type":"choice","instructions":"Pick","criteria":{"__proto__":null,"safe":null}}}',
    ) as Parameters<SystemOneClient["systemOne"]>[0]["questions"];
    const client = new SystemOneClient();
    const result = await client.systemOne({ state: "state", questions });

    expect(Object.hasOwn(result.answers, "__proto__")).toBe(true);
    const answer = result.answers.__proto__ as ChoiceResponse;
    expect(Object.hasOwn(answer.probabilities, "__proto__")).toBe(true);
    expect(answer.choice).toBe("__proto__");
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    client.dispose();
  });

  it("validates requests before creating a session", async () => {
    const client = new SystemOneClient();
    await expect(client.systemOne({ state: "x", questions: {} })).rejects.toThrow(
      "at least one question",
    );
    await expect(
      client.systemOne({
        state: "x",
        questions: { bad: choice("Pick", {}) },
      }),
    ).rejects.toThrow("between 1 and 255");
    await expect(
      client.systemOne({
        state: "x",
        questions: { bad: { type: "choice", criteria: null } as never },
      }),
    ).rejects.toThrow("criteria object");
    await expect(
      client.systemOne({
        state: "x",
        questions: { bad: score("Rate", ["only one"] as never) },
      }),
    ).rejects.toThrow("between 2 and 10");
    await expect(
      client.systemOne({
        state: "x",
        model: "jev-latest",
        questions: { yes: noul("True?") },
      }),
    ).rejects.toThrow("local tsfm model");
    await expect(
      client.systemOne({
        state: { invalid: Number.NaN } as never,
        questions: { yes: noul("True?") },
      }),
    ).rejects.toThrow("finite numbers");
    await expect(
      client.systemOne({
        state: { invalid: undefined } as never,
        questions: { yes: noul("True?") },
      }),
    ).rejects.toThrow("JSON-compatible");
    await expect(
      client.systemOne({
        state: "x",
        questions: { bad: noul("True?", [] as never) },
      }),
    ).rejects.toThrow("criteria object or null");
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).not.toHaveBeenCalled();
    client.dispose();
  });

  it("rejects circular state before creating a session", async () => {
    const state: { self?: unknown } = {};
    state.self = state;
    const client = new SystemOneClient();
    await expect(
      client.systemOne({ state: state as never, questions: { yes: noul("True?") } }),
    ).rejects.toThrow("circular references");
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).not.toHaveBeenCalled();
    client.dispose();
  });

  it("rejects malformed model output and releases native resources", async () => {
    respondWith('{"q0":[1.2,-0.2]}');
    const client = new SystemOneClient();
    await expect(
      client.systemOne({
        state: "x",
        questions: { route: choice("Pick", { a: null, b: null }) },
      }),
    ).rejects.toThrow("expected a probability between 0 and 1");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-content");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
    client.dispose();
  });

  it("rejects a response missing a required answer", async () => {
    respondWith("{}");
    const client = new SystemOneClient();
    await expect(
      client.systemOne({ state: "x", questions: { yes: noul("True?") } }),
    ).rejects.toThrow("missing required answer");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-content");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
    client.dispose();
  });

  it("cancels an active decision when its AbortSignal fires", async () => {
    let finish!: (result: { status: number; content: null; message: string }) => void;
    mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON.mockReturnValueOnce([
      new Promise((resolve) => {
        finish = resolve;
      }),
      "system-one-request",
    ] as never);

    const controller = new AbortController();
    const client = new SystemOneClient();
    const response = client.systemOne(
      { state: "x", questions: { yes: noul("True?") } },
      { signal: controller.signal },
    );
    await vi.waitFor(() =>
      expect(mockFns.FMLanguageModelSessionRespondWithSchemaFromJSON).toHaveBeenCalled(),
    );

    controller.abort();
    expect(mockFns.FMRequestCancel).toHaveBeenCalledWith("system-one-request");
    finish({ status: 20, content: null, message: "cancelled" });
    await expect(response).rejects.toThrow("cancelled");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-session-pointer");
    client.dispose();
  });

  it("rejects a pre-aborted decision without creating a session", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new SystemOneClient();
    await expect(
      client.systemOne(
        { state: "x", questions: { yes: noul("True?") } },
        { signal: controller.signal },
      ),
    ).rejects.toThrow("cancelled");
    expect(mockFns.FMLanguageModelSessionCreateFromSystemLanguageModel).not.toHaveBeenCalled();
    client.dispose();
  });

  it("does not dispose a caller-owned model", () => {
    const owner = new SystemOneClient();
    const supplied = owner.model;
    const client = new SystemOneClient({ model: supplied });
    client.dispose();
    expect(supplied._nativeModel).toBe("mock-model-pointer");
    owner.dispose();
  });

  it("rejects requests after disposal", async () => {
    const client = new SystemOneClient();
    client.dispose();
    await expect(
      client.systemOne({ state: "x", questions: { yes: noul("True?") } }),
    ).rejects.toThrow("disposed");
  });
});
