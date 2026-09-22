import { describe, expect, it } from "vitest";
import {
  fitDistributionCalibration,
  fitNoulCalibration,
  type DistributionExample,
  type NoulExample,
} from "../../src/calibration.js";

/** Overconfident estimates: the model says 0.95/0.05, reality is 70/30. */
function overconfidentNouls(): NoulExample[] {
  const examples: NoulExample[] = [];
  for (let i = 0; i < 100; i++) {
    examples.push({ probability: 0.95, actual: i % 10 < 7 });
    examples.push({ probability: 0.05, actual: i % 10 < 3 });
  }
  return examples;
}

describe("noul calibration", () => {
  it("softens overconfident probabilities toward the observed rate", () => {
    const calibration = fitNoulCalibration(overconfidentNouls());
    expect(calibration.temperature).toBeGreaterThan(1);
    expect(calibration.apply(0.95)).toBeGreaterThan(0.6);
    expect(calibration.apply(0.95)).toBeLessThan(0.85);
    expect(calibration.apply(0.05)).toBeGreaterThan(0.15);
    expect(calibration.apply(0.05)).toBeLessThan(0.4);
  });

  it("corrects a one-sided lean with the bias term", () => {
    // Every estimate is 0.5, but the truth is true three quarters of the time.
    const examples: NoulExample[] = Array.from({ length: 100 }, (_, i) => ({
      probability: 0.5,
      actual: i % 4 !== 0,
    }));
    const calibration = fitNoulCalibration(examples);
    expect(calibration.apply(0.5)).toBeGreaterThan(0.65);
    expect(calibration.apply(0.5)).toBeLessThan(0.85);
  });

  it("keeps already-calibrated probabilities close to where they were", () => {
    const examples: NoulExample[] = [];
    for (let i = 0; i < 100; i++) examples.push({ probability: 0.8, actual: i % 10 < 8 });
    for (let i = 0; i < 100; i++) examples.push({ probability: 0.2, actual: i % 10 < 2 });
    const calibration = fitNoulCalibration(examples);
    expect(calibration.apply(0.8)).toBeCloseTo(0.8, 1);
    expect(calibration.apply(0.2)).toBeCloseTo(0.2, 1);
  });

  it("survives the degenerate 0 and 1 the on-device model tends to emit", () => {
    const examples: NoulExample[] = [];
    for (let i = 0; i < 100; i++) examples.push({ probability: 1, actual: i % 10 < 6 });
    for (let i = 0; i < 100; i++) examples.push({ probability: 0, actual: i % 10 < 4 });
    const calibration = fitNoulCalibration(examples);
    const high = calibration.apply(1);
    const low = calibration.apply(0);
    expect(Number.isFinite(high)).toBe(true);
    expect(high).toBeLessThan(1);
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
  });

  it("can soften a bare 1 all the way down to its observed rate", () => {
    // Only 60% of the model's certain answers are right. Reaching 0.6 needs a
    // temperature near 34; a lower ceiling would pin the answer at about 0.67.
    const examples: NoulExample[] = [];
    for (let i = 0; i < 100; i++) examples.push({ probability: 1, actual: i % 10 < 6 });
    for (let i = 0; i < 100; i++) examples.push({ probability: 0, actual: i % 10 >= 6 });
    const calibration = fitNoulCalibration(examples);
    expect(calibration.apply(1)).toBeCloseTo(0.6, 2);
    expect(calibration.apply(0)).toBeCloseTo(0.4, 2);
  });

  it("rejects unusable input", () => {
    expect(() => fitNoulCalibration([])).toThrow("at least two");
    expect(() =>
      fitNoulCalibration([
        { probability: 2, actual: true },
        { probability: 0.5, actual: false },
      ]),
    ).toThrow("probability between 0 and 1");
    expect(() =>
      fitNoulCalibration([
        { probability: 0.5, actual: "yes" as never },
        { probability: 0.5, actual: false },
      ]),
    ).toThrow("boolean");
  });
});

describe("distribution calibration", () => {
  it("flattens one-hot distributions that are only sometimes right", () => {
    // The model is certain every time but correct only 60% of the time.
    const examples: DistributionExample[] = Array.from({ length: 100 }, (_, i) => ({
      probabilities: [1, 0, 0],
      actual: i % 10 < 6 ? 0 : 1,
    }));
    const calibration = fitDistributionCalibration(examples);
    expect(calibration.temperature).toBeGreaterThan(1);
    const corrected = calibration.apply([1, 0, 0]);
    expect(corrected[0]).toBeLessThan(1);
    expect(corrected[0]).toBeGreaterThan(corrected[1]);
    expect(corrected.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
  });

  it("can flatten a one-hot distribution all the way to its observed accuracy", () => {
    const examples: DistributionExample[] = Array.from({ length: 100 }, (_, i) => ({
      probabilities: [1, 0],
      actual: i % 10 < 6 ? 0 : 1,
    }));
    expect(fitDistributionCalibration(examples).apply([1, 0])[0]).toBeCloseTo(0.6, 2);
  });

  it("leaves a well-calibrated distribution roughly alone", () => {
    const examples: DistributionExample[] = Array.from({ length: 100 }, (_, i) => ({
      probabilities: [0.7, 0.2, 0.1],
      actual: i % 10 < 7 ? 0 : i % 10 < 9 ? 1 : 2,
    }));
    const calibration = fitDistributionCalibration(examples);
    const corrected = calibration.apply([0.7, 0.2, 0.1]);
    expect(corrected[0]).toBeCloseTo(0.7, 1);
  });

  it("always returns a normalized distribution", () => {
    const examples: DistributionExample[] = [
      { probabilities: [0.5, 0.5], actual: 0 },
      { probabilities: [0.5, 0.5], actual: 1 },
    ];
    const corrected = fitDistributionCalibration(examples).apply([0, 0, 0]);
    expect(corrected.reduce((sum, p) => sum + p, 0)).toBeCloseTo(1);
  });

  it("rejects unusable input", () => {
    expect(() => fitDistributionCalibration([{ probabilities: [1, 0], actual: 0 }])).toThrow(
      "at least two",
    );
    expect(() =>
      fitDistributionCalibration([
        { probabilities: [1, 0], actual: 5 },
        { probabilities: [1, 0], actual: 0 },
      ]),
    ).toThrow("in-range");
  });
});
