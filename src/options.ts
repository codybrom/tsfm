export type SamplingModeType = "greedy" | "random";

export interface SamplingMode {
  readonly type: SamplingModeType;
  /** Top-K sampling limit. Serialized as `top_k` in the C API options JSON. */
  readonly top?: number;
  /** Top-P (nucleus) probability threshold. Serialized as `top_p` in the C API options JSON. */
  readonly probabilityThreshold?: number;
  readonly seed?: number;
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
    if (opts.top !== undefined && opts.probabilityThreshold !== undefined) {
      throw new Error(
        "Cannot specify both 'top' and 'probabilityThreshold'. Choose one sampling constraint.",
      );
    }
    if (opts.top !== undefined && opts.top <= 0) {
      throw new Error("'top' must be a positive integer");
    }
    if (
      opts.probabilityThreshold !== undefined &&
      (opts.probabilityThreshold < 0.0 || opts.probabilityThreshold > 1.0)
    ) {
      throw new Error("'probabilityThreshold' must be between 0.0 and 1.0");
    }
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
}

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
    if (options.temperature < 0) {
      throw new Error("'temperature' must be non-negative");
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
    } else {
      const r: SerializedSampling = { mode: "random" };
      // Key names aligned with Python SDK: top_k, top_p
      if (sampling.top !== undefined) r.top_k = sampling.top;
      if (sampling.probabilityThreshold !== undefined) r.top_p = sampling.probabilityThreshold;
      if (sampling.seed !== undefined) r.seed = sampling.seed;
      obj.sampling = r;
    }
  }
  if (options.toolCallingMode !== undefined) {
    if (!["allowed", "required", "disallowed"].includes(options.toolCallingMode)) {
      throw new Error("'toolCallingMode' must be 'allowed', 'required' or 'disallowed'");
    }
    obj.tool_calling_mode = options.toolCallingMode;
  }
  // maximumToolCalls isn't sent: the session enforces it (see Tool._budgets).
  resolveMaximumToolCalls(options);

  return JSON.stringify(obj);
}
