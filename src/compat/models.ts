import type { SystemLanguageModel } from "../core.js";
import type { PrivateCloudComputeLanguageModel } from "../pcc.js";
import type { ReasoningLevel } from "../options.js";

/** The on-device model. The default when `model` is omitted. */
export const SYSTEM_MODEL = "SystemLanguageModel";
/** Private Cloud Compute. The host process needs Apple's PCC entitlement. */
export const PCC_MODEL = "PrivateCloudComputeLanguageModel";

export type CompatModelName = typeof SYSTEM_MODEL | typeof PCC_MODEL;
export type CompatModel = SystemLanguageModel | PrivateCloudComputeLanguageModel;

/**
 * Every accepted `model` value. `"system"` and `"pcc"` are the ids Apple's
 * `fm serve` uses for the same two models, so a client written for it selects
 * the model it meant. Responses still report the canonical name.
 */
const MODELS = new Map<string, CompatModelName>([
  [SYSTEM_MODEL, SYSTEM_MODEL],
  ["system", SYSTEM_MODEL],
  [PCC_MODEL, PCC_MODEL],
  ["pcc", PCC_MODEL],
]);

/** Returns the model a request's `model` field selects. Unknown names fall back to on-device. */
export function compatModelName(model: string | null | undefined): CompatModelName {
  return MODELS.get(model ?? SYSTEM_MODEL) ?? SYSTEM_MODEL;
}

/** Warns when `model` names neither supported model. */
export function warnOnUnknownModel(model: string | null | undefined): void {
  if (model != null && !MODELS.has(model)) {
    console.warn(
      `[tsfm compat] Model "${model}" is not supported. Use "${SYSTEM_MODEL}" (the default) ` +
        `or "${PCC_MODEL}". Falling back to "${SYSTEM_MODEL}".`,
    );
  }
}

/** `null` means the effort is understood but leaves the level unset. */
const EFFORT_TO_REASONING_LEVEL = new Map<string, ReasoningLevel | null>([
  ["none", null],
  ["minimal", "light"],
  ["low", "light"],
  ["medium", "moderate"],
  ["high", "deep"],
  ["xhigh", "deep"],
]);

/**
 * Maps an OpenAI reasoning effort to a tsfm `reasoningLevel`.
 *
 * Only Private Cloud Compute reasons. For the on-device model the effort is
 * warned about and ignored. `"none"` leaves the level unset.
 */
export function mapReasoningEffort(
  effort: string | null | undefined,
  model: CompatModelName,
  paramName: string,
): ReasoningLevel | undefined {
  if (effort == null) return undefined;
  if (model !== PCC_MODEL) {
    console.warn(
      `[tsfm compat] Parameter "${paramName}" needs model "${PCC_MODEL}". ` +
        `The on-device model doesn't reason. It will be ignored.`,
    );
    return undefined;
  }
  if (!EFFORT_TO_REASONING_LEVEL.has(effort)) {
    console.warn(
      `[tsfm compat] Parameter "${paramName}" value "${effort}" is not supported and will be ignored.`,
    );
    return undefined;
  }
  return EFFORT_TO_REASONING_LEVEL.get(effort) ?? undefined;
}
