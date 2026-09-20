import { SamplingMode, type GenerationOptions } from "../options.js";
import type { ChatCompletionCreateParams } from "./types.js";
import { compatModelName, mapReasoningEffort, warnOnUnknownModel } from "./models.js";

/** Params accepted for type compat but not supported by Apple Foundation Models. Warned at runtime. */
const UNSUPPORTED_PARAMS: ReadonlyArray<keyof ChatCompletionCreateParams> = [
  "n",
  "stop",
  "logprobs",
  "top_logprobs",
  "frequency_penalty",
  "presence_penalty",
  "logit_bias",
  "parallel_tool_calls",
  "service_tier",
  "store",
  "metadata",
  "prediction",
  "audio",
  "modalities",
  "user",
  "verbosity",
  "web_search_options",
  "prompt_cache_key",
  "prompt_cache_retention",
  "safety_identifier",
  "function_call",
  "functions",
];

/**
 * Maps ChatCompletionCreateParams into tsfm's GenerationOptions.
 * Emits console.warn for unsupported params and unknown model names.
 *
 * `reasoning_effort` maps to `reasoningLevel` when `model` is
 * `"PrivateCloudComputeLanguageModel"`; the on-device model doesn't reason.
 */
/**
 * A caller's params, with only their own properties. Request objects arrive as
 * plain JSON from outside the SDK, and reading them directly would let a
 * polluted `Object.prototype` supply values the caller never sent -- a model,
 * a reasoning effort, a stream option. Copy once at the boundary and every
 * read after it is the caller's own.
 */
export function ownParams<T extends object>(params: T): T {
  // Object.create(null), not a spread: a spread copies own properties but the
  // copy still inherits from Object.prototype, so reading a key the caller
  // didn't send would still find a polluted one. This copy has no prototype,
  // so a missing key reads as undefined.
  return Object.assign(Object.create(null) as T, params);
}

export function mapParams(raw: Partial<ChatCompletionCreateParams>): GenerationOptions {
  const params = ownParams(raw);
  const options: GenerationOptions = {};

  warnOnUnknownModel(params.model);

  const reasoningLevel = mapReasoningEffort(
    params.reasoning_effort,
    compatModelName(params.model),
    "reasoning_effort",
  );
  if (reasoningLevel !== undefined) options.reasoningLevel = reasoningLevel;

  // temperature — independent of sampling mode
  if (params.temperature != null) {
    options.temperature = params.temperature;
  }

  // max_completion_tokens takes priority over max_tokens
  if (params.max_completion_tokens != null) {
    if (params.max_tokens != null) {
      console.warn(
        `[tsfm compat] Both "max_tokens" and "max_completion_tokens" are set. "max_completion_tokens" will be used.`,
      );
    }
    options.maximumResponseTokens = params.max_completion_tokens;
  } else if (params.max_tokens != null) {
    options.maximumResponseTokens = params.max_tokens;
  }

  // Build sampling mode from top_p and/or seed
  const topP = params.top_p ?? undefined;
  const seed = params.seed ?? undefined;

  if (topP !== undefined || seed !== undefined) {
    options.sampling = SamplingMode.random({
      ...(topP !== undefined ? { probabilityThreshold: topP } : {}),
      ...(seed !== undefined ? { seed } : {}),
    });
  }

  // Specific warning for tool_choice since it affects expected behavior
  if (params.tool_choice != null && params.tool_choice !== "auto") {
    console.warn(
      `[tsfm compat] Parameter "tool_choice" value "${typeof params.tool_choice === "string" ? params.tool_choice : "object"}" is not supported. ` +
        `Apple Foundation Models always uses "auto" tool selection. The parameter will be ignored.`,
    );
  }

  // Only include_usage is supported; Chat Completions has no other stream option.
  const rawStreamOptions = params.stream_options;
  if (rawStreamOptions != null && typeof rawStreamOptions !== "object") {
    console.warn(
      `[tsfm compat] Parameter "stream_options" must be an object; got ${typeof rawStreamOptions}. It will be ignored.`,
    );
  } else if (rawStreamOptions) {
    const streamOptions = ownParams(rawStreamOptions) as Record<string, unknown>;
    if ("include_usage" in streamOptions && typeof streamOptions.include_usage !== "boolean") {
      console.warn(
        `[tsfm compat] Parameter "stream_options.include_usage" must be a boolean; got ${typeof streamOptions.include_usage}. It will be ignored.`,
      );
    }
    for (const key of Object.keys(streamOptions)) {
      if (key !== "include_usage" && streamOptions[key] != null) {
        console.warn(
          `[tsfm compat] Parameter "stream_options.${key}" is not supported and will be ignored.`,
        );
      }
    }
  }

  // Warn on unsupported params that are non-null
  for (const key of UNSUPPORTED_PARAMS) {
    if (params[key] != null) {
      console.warn(`[tsfm compat] Parameter "${key}" is not supported and will be ignored.`);
    }
  }

  return options;
}
