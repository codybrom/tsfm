export type SamplingModeType = "greedy" | "random";

export interface SamplingMode {
  readonly type: SamplingModeType;
  /** Top-K sampling limit. Serialized as `top_k` in the C API options JSON. */
  readonly top?: number;
  /** Top-P (nucleus) probability threshold. Serialized as `top_p` in the C API options JSON. */
  readonly probabilityThreshold?: number;
  readonly seed?: number;
}

/**
 * Checks the constraints of a random sampling mode. Shared by
 * `SamplingMode.random()` and `serializeOptions()`, because `SamplingMode` is
 * a plain object that can be built by hand: the bridge reads `top` and `seed`
 * with `as? Int` / `as? UInt64` and silently drops a value that doesn't fit,
 * and a `top` of zero would reach the framework unchecked.
 */
function validateRandomSampling(opts: {
  top?: number;
  probabilityThreshold?: number;
  seed?: number;
}): void {
  if (opts.top !== undefined && opts.probabilityThreshold !== undefined) {
    throw new Error(
      "Cannot specify both 'top' and 'probabilityThreshold'. Choose one sampling constraint.",
    );
  }
  if (opts.top !== undefined && (!Number.isSafeInteger(opts.top) || opts.top <= 0)) {
    throw new Error("'top' must be a positive integer");
  }
  // typeof, not just the comparisons: `true` and `"0.5"` both compare as
  // being within 0..1, and would serialize as the wrong JSON type.
  if (
    opts.probabilityThreshold !== undefined &&
    (typeof opts.probabilityThreshold !== "number" ||
      !(opts.probabilityThreshold >= 0.0 && opts.probabilityThreshold <= 1.0))
  ) {
    throw new Error("'probabilityThreshold' must be a number between 0.0 and 1.0");
  }
  // The framework takes a UInt64; JavaScript can only represent integers up to
  // 2^53 exactly, so that's the range accepted.
  if (opts.seed !== undefined && (!Number.isSafeInteger(opts.seed) || opts.seed < 0)) {
    throw new Error("'seed' must be a non-negative integer no larger than Number.MAX_SAFE_INTEGER");
  }
}

export const SamplingMode = {
  greedy(): SamplingMode {
    return { type: "greedy" };
  },
  random(
    opts: {
      top?: number;
      probabilityThreshold?: number;
      seed?: number;
    } = {},
  ): SamplingMode {
    validateRandomSampling(opts);
    return { type: "random", ...opts };
  },
};

/** How the model may use the session's tools for a request. */
export type ToolCallingMode = "allowed" | "required" | "disallowed";

/** The default for `maximumToolCalls`. */
export const DEFAULT_MAXIMUM_TOOL_CALLS = 32;

export interface GenerationOptions {
  sampling?: SamplingMode;
  temperature?: number;
  maximumResponseTokens?: number;
  /**
   * `"allowed"` (the default): the model may call tools. `"required"`: it must
   * call at least one before answering. `"disallowed"`: it answers from what it
   * knows. With `"required"` the model keeps calling tools, so the request ends
   * with `ToolCallLimitExceededError` once `maximumToolCalls` is reached unless a
   * tool throws first.
   */
  toolCallingMode?: ToolCallingMode;
  /**
   * The most tool calls one request may make (default 32). The call after the
   * limit isn't run, and the request fails with `ToolCallLimitExceededError`.
   */
  maximumToolCalls?: number;
  /**
   * How much the model reasons before answering. Only
   * `PrivateCloudComputeLanguageModel` reasons; the on-device model rejects it
   * with `UnsupportedCapabilityError`.
   */
  reasoningLevel?: ReasoningLevel;
  /**
   * Whether a schema request puts the schema in the prompt (default `true`).
   * Set `false` when the model already knows the format, e.g. from earlier
   * turns, to save tokens. Text requests ignore it.
   */
  includeSchemaInPrompt?: boolean;
}

/** Reasoning effort for `PrivateCloudComputeLanguageModel`. */
export type ReasoningLevel = "light" | "moderate" | "deep";

interface SerializedSampling {
  mode: string;
  top_k?: number;
  top_p?: number;
  seed?: number;
}

interface SerializedOptions {
  temperature?: number;
  maximum_response_tokens?: number;
  sampling?: SerializedSampling | { mode: "greedy" };
  tool_calling_mode?: ToolCallingMode;
  reasoning_level?: ReasoningLevel;
  include_schema_in_prompt?: boolean;
}

/** The tool-call limit for a request, validated. */
export function resolveMaximumToolCalls(options: GenerationOptions | undefined): number {
  const max = options?.maximumToolCalls ?? DEFAULT_MAXIMUM_TOOL_CALLS;
  if (!Number.isInteger(max) || max < 0) {
    throw new Error("'maximumToolCalls' must be a non-negative integer");
  }
  return max;
}

export function serializeOptions(options: GenerationOptions | undefined): string | null {
  if (!options) return null;

  const obj: SerializedOptions = {};

  if (options.temperature !== undefined) {
    // Apple documents the range as 0 to 1 inclusive.
    if (!(options.temperature >= 0 && options.temperature <= 1)) {
      throw new Error("'temperature' must be a number between 0 and 1 inclusive");
    }
    obj.temperature = options.temperature;
  }
  if (options.maximumResponseTokens !== undefined) {
    if (!Number.isInteger(options.maximumResponseTokens) || options.maximumResponseTokens <= 0) {
      throw new Error("'maximumResponseTokens' must be a positive integer");
    }
    // Key name aligned with Python SDK: maximum_response_tokens
    obj.maximum_response_tokens = options.maximumResponseTokens;
  }
  if (options.sampling) {
    const sampling = options.sampling;
    if (sampling.type === "greedy") {
      obj.sampling = { mode: "greedy" };
    } else if (sampling.type === "random") {
      validateRandomSampling(sampling);
      const r: SerializedSampling = { mode: "random" };
      // Key names aligned with Python SDK: top_k, top_p
      if (sampling.top !== undefined) r.top_k = sampling.top;
      if (sampling.probabilityThreshold !== undefined) r.top_p = sampling.probabilityThreshold;
      if (sampling.seed !== undefined) r.seed = sampling.seed;
      obj.sampling = r;
    } else {
      throw new Error("'sampling.type' must be 'greedy' or 'random'");
    }
  }
  if (options.toolCallingMode !== undefined) {
    if (!["allowed", "required", "disallowed"].includes(options.toolCallingMode)) {
      throw new Error("'toolCallingMode' must be 'allowed', 'required' or 'disallowed'");
    }
    obj.tool_calling_mode = options.toolCallingMode;
  }
  if (options.reasoningLevel !== undefined) {
    if (!["light", "moderate", "deep"].includes(options.reasoningLevel)) {
      throw new Error("'reasoningLevel' must be 'light', 'moderate' or 'deep'");
    }
    obj.reasoning_level = options.reasoningLevel;
  }
  if (options.includeSchemaInPrompt !== undefined) {
    if (typeof options.includeSchemaInPrompt !== "boolean") {
      throw new Error("'includeSchemaInPrompt' must be a boolean");
    }
    obj.include_schema_in_prompt = options.includeSchemaInPrompt;
  }
  // maximumToolCalls isn't sent: the session enforces it (see Tool._budgets).
  resolveMaximumToolCalls(options);

  return JSON.stringify(obj);
}
