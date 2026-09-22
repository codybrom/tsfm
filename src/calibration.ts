/**
 * Post-hoc probability calibration.
 *
 * The on-device model's probabilities are estimates it writes into a schema,
 * not measured frequencies, and on the public JevBench cases they were badly
 * overconfident: most answers come back as a bare 0 or 1. Temperature scaling
 * corrects that after the fact, but only against labelled examples — so these
 * fitters take *your* data and return a transform for *your* workload. There
 * is no useful universal constant to ship here.
 *
 * Fit on examples the model has not otherwise been tuned against, and keep a
 * held-out split to check the fit on, exactly as you would for any calibrator.
 */

/** Probabilities are pulled this far away from 0 and 1 before taking a log. */
const EPSILON = 1e-6;

/** One labelled yes/no outcome. */
export interface NoulExample {
  /** The probability the model reported for `true`. */
  readonly probability: number;
  /** What actually happened. */
  readonly actual: boolean;
}

/** One labelled outcome over a distribution, such as a choice or a score. */
export interface DistributionExample {
  /** The distribution the model reported, in criterion order. */
  readonly probabilities: readonly number[];
  /** The index of the criterion that was actually correct. */
  readonly actual: number;
}

/** A fitted transform for yes/no probabilities. */
export interface NoulCalibration {
  /** Above 1 softens the estimate; below 1 sharpens it. */
  readonly temperature: number;
  /** Corrects a systematic lean toward `true` or `false`. */
  readonly bias: number;
  /** Mean negative log-likelihood on the examples it was fitted to. */
  readonly logLoss: number;
  apply(probability: number): number;
}

/** A fitted transform for a distribution over criteria. */
export interface DistributionCalibration {
  /** Above 1 flattens the distribution; below 1 concentrates it. */
  readonly temperature: number;
  /** Mean negative log-likelihood on the examples it was fitted to. */
  readonly logLoss: number;
  apply(probabilities: readonly number[]): number[];
}

function clamp(probability: number): number {
  return Math.min(1 - EPSILON, Math.max(EPSILON, probability));
}

function validProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function logit(probability: number): number {
  const p = clamp(probability);
  return Math.log(p / (1 - p));
}

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Searches `steps` points across `[low, high]`, then repeatedly narrows the
 * range around the best point. Enough for one or two smooth parameters, and it
 * keeps this module dependency-free.
 */
function search(
  low: number,
  high: number,
  loss: (value: number) => number,
  rounds = 8,
  steps = 24,
): number {
  let best = low;
  let bestLoss = Infinity;
  let [from, to] = [low, high];
  for (let round = 0; round < rounds; round++) {
    const width = (to - from) / steps;
    for (let step = 0; step <= steps; step++) {
      const value = from + width * step;
      const current = loss(value);
      if (current < bestLoss) {
        bestLoss = current;
        best = value;
      }
    }
    from = Math.max(low, best - width);
    to = Math.min(high, best + width);
  }
  return best;
}

// A clamped 0 or 1 has a log-odds of about ±13.8, so flattening one of the
// on-device model's bare 0/1 answers to a realistic rate takes a temperature
// in the tens: 60% accuracy needs about 34. The ceiling is high enough to reach
// a near-uniform answer, and the search runs over log(temperature) so the wide
// range doesn't cost resolution at the small temperatures that matter too.
const MIN_TEMPERATURE = 0.05;
const MAX_TEMPERATURE = 1000;

/** Searches temperatures on a log scale between the two bounds. */
function searchTemperature(loss: (temperature: number) => number): number {
  const exponent = search(Math.log(MIN_TEMPERATURE), Math.log(MAX_TEMPERATURE), (value) =>
    loss(Math.exp(value)),
  );
  return Math.exp(exponent);
}
const MAX_BIAS = 5;

function applyNoul(probability: number, temperature: number, bias: number): number {
  return sigmoid(logit(probability) / temperature + bias);
}

function applyDistribution(probabilities: readonly number[], temperature: number): number[] {
  const powered = probabilities.map((p) => Math.pow(clamp(p), 1 / temperature));
  const total = powered.reduce((sum, value) => sum + value, 0);
  return total === 0
    ? probabilities.map(() => 1 / probabilities.length)
    : powered.map((value) => value / total);
}

/**
 * Fits a temperature and bias for yes/no probabilities by minimizing log loss.
 *
 * ```ts
 * const calibration = fitNoulCalibration(labelled);
 * const corrected = calibration.apply(answer.noul);
 * ```
 */
export function fitNoulCalibration(examples: readonly NoulExample[]): NoulCalibration {
  if (!Array.isArray(examples) || examples.length < 2) {
    throw new TypeError("Calibration needs at least two labelled examples");
  }
  for (const example of examples) {
    if (!example || !validProbability(example.probability)) {
      throw new TypeError("Every example needs a probability between 0 and 1");
    }
    if (typeof example.actual !== "boolean") {
      throw new TypeError("Every example needs a boolean 'actual'");
    }
  }

  const loss = (temperature: number, bias: number): number => {
    let total = 0;
    for (const { probability, actual } of examples) {
      const p = clamp(applyNoul(probability, temperature, bias));
      total -= actual ? Math.log(p) : Math.log(1 - p);
    }
    return total / examples.length;
  };

  // Alternate between the two parameters; each pass is a smooth 1-D search.
  let temperature = 1;
  let bias = 0;
  for (let round = 0; round < 4; round++) {
    temperature = searchTemperature((value) => loss(value, bias));
    bias = search(-MAX_BIAS, MAX_BIAS, (value) => loss(temperature, value));
  }

  return {
    temperature,
    bias,
    logLoss: loss(temperature, bias),
    apply: (probability: number) => applyNoul(probability, temperature, bias),
  };
}

/**
 * Fits a temperature for distributions over criteria by minimizing log loss.
 *
 * ```ts
 * const calibration = fitDistributionCalibration(labelled);
 * const corrected = calibration.apply(Object.values(answer.probabilities));
 * ```
 */
export function fitDistributionCalibration(
  examples: readonly DistributionExample[],
): DistributionCalibration {
  if (!Array.isArray(examples) || examples.length < 2) {
    throw new TypeError("Calibration needs at least two labelled examples");
  }
  for (const example of examples) {
    if (!example || !Array.isArray(example.probabilities) || example.probabilities.length < 2) {
      throw new TypeError("Every example needs at least two probabilities");
    }
    if (!example.probabilities.every(validProbability)) {
      throw new TypeError("Every probability must be between 0 and 1");
    }
    if (
      !Number.isInteger(example.actual) ||
      example.actual < 0 ||
      example.actual >= example.probabilities.length
    ) {
      throw new TypeError("Every example needs an in-range 'actual' index");
    }
  }

  const loss = (temperature: number): number => {
    let total = 0;
    for (const { probabilities, actual } of examples) {
      total -= Math.log(clamp(applyDistribution(probabilities, temperature)[actual]));
    }
    return total / examples.length;
  };

  const temperature = searchTemperature(loss);
  return {
    temperature,
    logLoss: loss(temperature),
    apply: (probabilities: readonly number[]) => applyDistribution(probabilities, temperature),
  };
}
