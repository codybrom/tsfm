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
export function mapParams(params: Partial<ChatCompletionCreateParams>): GenerationOptions {
  const options: GenerationOptions = {};

  // The two fields that pick a model and its reasoning are read as own
  // properties: these params come from a caller's JSON, and a polluted
  // Object.prototype would otherwise choose the model for them.
  const own = <K extends keyof ChatCompletionCreateParams>(
    key: K,
  ): ChatCompletionCreateParams[K] | undefined =>
    Object.hasOwn(params, key) ? params[key] : undefined;
  const model = own("model");

  warnOnUnknownModel(model);

  const reasoningLevel = mapReasoningEffort(
    own("reasoning_effort"),
    compatModelName(model),
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
  const streamOptions = params.stream_options as Record<string, unknown> | null | undefined;
  for (const key of Object.keys(streamOptions ?? {})) {
    if (key !== "include_usage" && streamOptions?.[key] != null) {
      console.warn(
        `[tsfm compat] Parameter "stream_options.${key}" is not supported and will be ignored.`,
      );
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
