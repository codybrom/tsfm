import { describe, expect, it } from "vitest";
import { averageAnswers, concentration, selectIndex } from "../../src/system-one-answers.js";
import { choice, noul, score, type Question } from "../../src/system-one.js";

describe("selectIndex", () => {
  it("picks the largest probability", () => {
    expect(selectIndex([0.1, 0.7, 0.2], ["a", "b", "c"])).toBe(1);
  });

  it("breaks a Choice tie by label, not by where the label was listed", () => {
    const forward = selectIndex([0.5, 0.5], ["alpha", "beta"]);
    const reversed = selectIndex([0.5, 0.5], ["beta", "alpha"]);
    expect(["alpha", "beta"][forward]).toBe(["beta", "alpha"][reversed]);
  });

  it("breaks a Score tie toward the lowest level", () => {
    expect(selectIndex([0, 0.5, 0.5])).toBe(1);
  });
});

describe("concentration", () => {
  it("is 0 for a uniform distribution and 1 for a one-hot one", () => {
    expect(concentration([0.25, 0.25, 0.25, 0.25])).toBe(0);
    expect(concentration([0, 1, 0])).toBe(1);
    expect(concentration([1])).toBe(1);
  });
});

describe("averageAnswers", () => {
  it("lines samples up by label and question name, whatever order they arrived in", () => {
    const entries: [string, Question][] = [
      ["yes", noul("True?")],
      ["route", choice("Pick", { a: null, b: null })],
      ["level", score("Rate", ["low", "high"])],
    ];
    const sample = (p: number, a: number, low: number) => ({
      yes: { type: "noul", noul: p },
      // A rotated sample can hold its labels in a different key order.
      route: {
        type: "choice",
        choice: "a",
        confidence: 0,
        probabilities: a > 0.5 ? { a, b: 1 - a } : { b: 1 - a, a },
      },
      level: {
        type: "score",
        score: 0,
        confidence: 0,
        legend: { 0: "low", 1: "high" },
        probabilities: { 0: low, 1: 1 - low },
      },
    });

    const averaged = averageAnswers(
      [sample(0.9, 0.8, 0.6), sample(0.5, 0.2, 0.2)] as never,
      entries,
    ) as Record<
      string,
      { noul?: number; probabilities?: Record<string, number>; score?: number; choice?: string }
    >;

    expect(averaged.yes.noul).toBeCloseTo(0.7);
    expect(averaged.route.probabilities).toEqual({ a: 0.5, b: 0.5 });
    expect(averaged.level.probabilities?.["0"]).toBeCloseTo(0.4);
    expect(averaged.level.score).toBeCloseTo(0.6);
  });
});
