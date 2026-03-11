import { SamplingMode, type GenerationOptions } from "../options.js";
import type { ChatCompletionCreateParams } from "./types.js";

/** OpenAI params accepted for type compat but not supported by Apple Foundation Models. Warned at runtime. */
const UNSUPPORTED_PARAMS: ReadonlyArray<keyof ChatCompletionCreateParams> = [
  "n",
  "stop",
  "logprobs",
  "top_logprobs",
  "frequency_penalty",
  "presence_penalty",
  "logit_bias",
  "parallel_tool_calls",
  "tool_choice",
  "service_tier",
  "store",
  "metadata",
  "prediction",
  "reasoning_effort",
  "audio",
  "modalities",
  "user",
  "stream_options",
  "verbosity",
  "web_search_options",
  "prompt_cache_key",
  "prompt_cache_retention",
  "safety_identifier",
  "function_call",
  "functions",
];

/**
 * Maps OpenAI-style ChatCompletionCreateParams into tsfm's GenerationOptions.
 * Emits console.warn for unsupported params and non-standard model names.
 */
export function mapParams(params: ChatCompletionCreateParams): GenerationOptions {
  const options: GenerationOptions = {};

  // Warn on non-standard model names
  if (params.model !== undefined && params.model !== "apple-intelligence") {
    console.warn(
      `[tsfm compat] Model "${params.model}" is not supported. Use "apple-intelligence" or omit the model field.`,
    );
  }

  // temperature — independent of sampling mode
  if (params.temperature != null) {
    options.temperature = params.temperature;
  }

  // max_completion_tokens takes priority over max_tokens
  if (params.max_completion_tokens != null) {
    options.maximumResponseTokens = params.max_completion_tokens;
  } else if (params.max_tokens != null) {
    options.maximumResponseTokens = params.max_tokens;
  }

  // Build sampling mode from top_p and/or seed
  const topP = params.top_p != null ? params.top_p : undefined;
  const seed = params.seed != null ? params.seed : undefined;

  if (topP !== undefined || seed !== undefined) {
    options.sampling = SamplingMode.random({
      ...(topP !== undefined ? { probabilityThreshold: topP } : {}),
      ...(seed !== undefined ? { seed } : {}),
    });
  }

  // Warn on unsupported params that are non-null
  for (const key of UNSUPPORTED_PARAMS) {
    if (params[key] != null) {
      console.warn(`[tsfm compat] Parameter "${key}" is not supported and will be ignored.`);
    }
  }

  return options;
}
