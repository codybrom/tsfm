/**
 * @internal The arithmetic that turns probability distributions into System One
 * answers: picking a winner without letting criterion order decide a tie,
 * measuring how concentrated a distribution is, and averaging an ensemble's
 * samples.
 *
 * Nothing here touches the native bridge. `system-one.ts` owns asking the
 * model and parsing what it returns; this module owns what the numbers mean
 * once they are probabilities, for a single answer and for several.
 */

import type {
  ChoiceResponse,
  EntryType,
  NoulResponse,
  Question,
  Questions,
  ScoreCriteria,
  ScoreResponse,
  SystemOneResult,
} from "./system-one.js";

/** Probabilities within this of the largest count as tied. */
const TIE_EPSILON = 1e-12;

/** FNV-1a, enough to order tied labels deterministically. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The index of the largest probability.
 *
 * With `labels`, an exact tie is broken by hashing the tied labels rather than
 * by taking the first of them. Choice labels are unordered, so breaking a tie
 * by index quietly turns "no idea" into a vote for whichever criterion the
 * caller happened to list first — which is how an ensemble of one-hot samples
 * manufactures a first-position bias. Without `labels` the lowest index wins,
 * because score levels are ordered and the lowest tied level is a meaningful,
 * conservative answer. Either way a full tie leaves `confidence` at zero.
 */
export function selectIndex(values: readonly number[], labels?: readonly string[]): number {
  let best = 0;
  for (let index = 1; index < values.length; index++) {
    if (values[index] > values[best]) best = index;
  }
  if (!labels) return best;

  const top = values[best];
  const tied = values.reduce<number[]>((all, value, index) => {
    if (top - value <= TIE_EPSILON) all.push(index);
    return all;
  }, []);
  if (tied.length < 2) return best;
  return tied.reduce((left, right) =>
    stableHash(labels[right]) < stableHash(labels[left]) ? right : left,
  );
}

/**
 * Distribution concentration on a 0..1 scale. It is 0 for a uniform
 * distribution and 1 for a one-hot distribution. It is not calibrated model
 * confidence; callers should tune action thresholds against their own data.
 */
export function concentration(values: readonly number[]): number {
  if (values.length <= 1) return 1;
  const largest = Math.max(...values);
  const value = Math.max(0, Math.min(1, (values.length * largest - 1) / (values.length - 1)));
  return Math.round(value * 1e12) / 1e12;
}

/** Mean of the probabilities each sample assigned to `key`. */
function meanProbability(samples: readonly Record<string, number>[], key: string): number {
  return samples.reduce((sum, probs) => sum + (probs[key] ?? 0), 0) / samples.length;
}

/**
 * Averages one answer per question across ensemble samples. Choice
 * probabilities are keyed by label, so a rotated sample lines back up with the
 * original criteria order without any un-permuting.
 */
/** A Choice answer from its labels and a normalized distribution in the same order. */
export function choiceAnswer(labels: readonly string[], values: readonly number[]): ChoiceResponse {
  const probabilities: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [index, label] of labels.entries()) probabilities[label] = values[index];
  return {
    type: "choice",
    choice: labels[selectIndex(values, labels)],
    confidence: concentration(values),
    probabilities,
  };
}

/**
 * A Score answer from its rubric and a normalized distribution over its levels:
 * the score is the distribution's expected level.
 */
export function scoreAnswer(criteria: ScoreCriteria, values: readonly number[]): ScoreResponse {
  const legend: Record<string, EntryType> = Object.create(null) as Record<string, EntryType>;
  const probabilities: Record<string, number> = Object.create(null) as Record<string, number>;
  let expected = 0;
  for (const [index, description] of criteria.entries()) {
    legend[String(index)] = description;
    probabilities[String(index)] = values[index];
    expected += index * values[index];
  }
  return {
    type: "score",
    score: expected,
    confidence: concentration(values),
    legend,
    probabilities,
  } as ScoreResponse;
}

export function averageAnswers<Q extends Questions>(
  samples: readonly SystemOneResult<Q>["answers"][],
  entries: readonly (readonly [string, Question])[],
): SystemOneResult<Q>["answers"] {
  const answers: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const [id, question] of entries) {
    const typed = samples.map((sample) => (sample as Record<string, unknown>)[id]);
    if (question.type === "noul") {
      const values = typed as NoulResponse[];
      answers[id] = {
        type: "noul",
        noul: values.reduce((sum, item) => sum + item.noul, 0) / values.length,
      } satisfies NoulResponse;
      continue;
    }

    const distributions = (typed as { probabilities: Record<string, number> }[]).map(
      (item) => item.probabilities,
    );
    // Probabilities are keyed by label or level, so a rotated sample lines up
    // with the original criteria order without any un-permuting.
    if (question.type === "choice") {
      const labels = Object.keys(question.criteria);
      answers[id] = choiceAnswer(
        labels,
        labels.map((label) => meanProbability(distributions, label)),
      );
      continue;
    }
    answers[id] = scoreAnswer(
      question.criteria,
      question.criteria.map((_, level) => meanProbability(distributions, String(level))),
    );
  }

  return answers as SystemOneResult<Q>["answers"];
}
