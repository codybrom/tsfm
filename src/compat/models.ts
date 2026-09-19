import type { SystemLanguageModel } from "../core.js";
import type { PrivateCloudComputeLanguageModel } from "../pcc.js";
import type { ReasoningLevel } from "../options.js";

/** The on-device model. The default when `model` is omitted. */
export const SYSTEM_MODEL = "SystemLanguageModel";
/** Private Cloud Compute. The host process needs Apple's PCC entitlement. */
export const PCC_MODEL = "PrivateCloudComputeLanguageModel";

export type CompatModelName = typeof SYSTEM_MODEL | typeof PCC_MODEL;
export type CompatModel = SystemLanguageModel | PrivateCloudComputeLanguageModel;

/** Returns the model a request's `model` field selects. Unknown names fall back to on-device. */
export function compatModelName(model: string | null | undefined): CompatModelName {
  return model === PCC_MODEL ? PCC_MODEL : SYSTEM_MODEL;
}

/** Warns when `model` names neither supported model. */
export function warnOnUnknownModel(model: string | null | undefined): void {
  if (model != null && model !== SYSTEM_MODEL && model !== PCC_MODEL) {
    console.warn(
      `[tsfm compat] Model "${model}" is not supported. Use "${SYSTEM_MODEL}" (the default) ` +
        `or "${PCC_MODEL}". Falling back to "${SYSTEM_MODEL}".`,
    );
  }
}

const EFFORT_TO_REASONING_LEVEL: Record<string, ReasoningLevel | null> = {
  none: null,
  minimal: "light",
  low: "light",
  medium: "moderate",
  high: "deep",
  xhigh: "deep",
};

/**
 * Maps an OpenAI reasoning effort to a tsfm `reasoningLevel`.
 *
 * Only Private Cloud Compute reasons; for the on-device model the effort is
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
      `[tsfm compat] Parameter "${paramName}" needs model "${PCC_MODEL}"; ` +
        `the on-device model doesn't reason. It will be ignored.`,
    );
    return undefined;
  }
  // hasOwn, not `in`: "constructor" or "toString" would otherwise pass.
  if (!Object.hasOwn(EFFORT_TO_REASONING_LEVEL, effort)) {
    console.warn(
      `[tsfm compat] Parameter "${paramName}" value "${effort}" is not supported and will be ignored.`,
    );
    return undefined;
  }
  return EFFORT_TO_REASONING_LEVEL[effort] ?? undefined;
}
