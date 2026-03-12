// Chat Completions type definitions for the Apple Foundation Models compat layer.
// This is a pure types file with no runtime code.

import type { JsonSchema, JsonObject } from "../schema.js";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type ChatCompletionSystemMessageParam = {
  role: "system";
  content: string | Array<{ type: "text"; text: string }>;
  name?: string;
};

export type ChatCompletionDeveloperMessageParam = {
  role: "developer";
  content: string | Array<{ type: "text"; text: string }>;
  name?: string;
};

export type ChatCompletionContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { file_data?: string; file_id?: string; filename?: string } }
  | { type: "refusal"; refusal: string };

export type ChatCompletionUserMessageParam = {
  role: "user";
  content: string | Array<ChatCompletionContentPart>;
  name?: string;
};

export type ChatCompletionMessageToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ChatCompletionAssistantMessageParam = {
  role: "assistant";
  content?: string | Array<ChatCompletionContentPart> | null;
  tool_calls?: ChatCompletionMessageToolCall[];
  refusal?: string | null;
  name?: string;
};

export type ChatCompletionToolMessageParam = {
  role: "tool";
  content: string | Array<{ type: "text"; text: string }>;
  tool_call_id: string;
};

export type ChatCompletionMessageParam =
  | ChatCompletionSystemMessageParam
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionUserMessageParam
  | ChatCompletionAssistantMessageParam
  | ChatCompletionToolMessageParam;

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

export type ChatCompletionTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: JsonSchema;
    strict?: boolean | null;
  };
};

// ---------------------------------------------------------------------------
// Response format
// ---------------------------------------------------------------------------

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        description?: string;
        schema?: JsonSchema;
        strict?: boolean | null;
      };
    };

// ---------------------------------------------------------------------------
// Request params
// ---------------------------------------------------------------------------

/**
 * Request params for `chat.completions.create()`.
 *
 * All standard params are accepted for type compatibility. Supported params are
 * mapped to Foundation Models GenerationOptions; unsupported params are warned
 * and silently ignored at runtime (see `mapParams()` and `UNSUPPORTED_PARAMS`).
 */
export type ChatCompletionCreateParams = {
  // Required
  messages: ChatCompletionMessageParam[];

  // Supported params (model is optional here for convenience — this layer only
  // supports one model so omitting it is safe)
  model?: string;
  temperature?: number | null;
  max_tokens?: number | null;
  max_completion_tokens?: number | null;
  top_p?: number | null;
  seed?: number | null;
  stream?: boolean | null;
  tools?: ChatCompletionTool[];
  response_format?: ResponseFormat;

  // Accepted but ignored (unsupported by Foundation Models)
  n?: number | null;
  stop?: string | string[] | null;
  logprobs?: boolean | null;
  top_logprobs?: number | null;
  frequency_penalty?: number | null;
  presence_penalty?: number | null;
  logit_bias?: Record<string, number> | null;
  parallel_tool_calls?: boolean;
  tool_choice?: "none" | "auto" | "required" | { type: "function"; function: { name: string } };
  service_tier?: string | null;
  store?: boolean | null;
  metadata?: Record<string, string> | null;
  prediction?: { type: "content"; content: string | Array<{ type: "text"; text: string }> };
  reasoning_effort?: string | null;
  audio?: { voice: string; format: string } | null;
  modalities?: string[] | null;
  user?: string;
  stream_options?: { include_usage?: boolean } | null;
  verbosity?: string | null;
  web_search_options?: { search_context_size?: string; user_location?: JsonObject } | null;
  prompt_cache_key?: string;
  prompt_cache_retention?: string | null;
  safety_identifier?: string;
  /** @deprecated Use `tools` and `tool_choice` instead. */
  function_call?: "none" | "auto" | { name: string };
  /** @deprecated Use `tools` instead. */
  functions?: Array<{ name: string; description?: string; parameters?: JsonSchema }>;
};

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type ChatCompletionMessage = {
  role: "assistant";
  content: string | null;
  tool_calls?: ChatCompletionMessageToolCall[];
  refusal: string | null;
};

export type ChatCompletionChoice = {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter";
};

export type ChatCompletion = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: null;
  system_fingerprint: null;
};

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

export type ChatCompletionChunkDelta = {
  role?: "assistant";
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: "function";
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
  refusal?: string | null;
};

export type ChatCompletionChunkChoice = {
  index: number;
  delta: ChatCompletionChunkDelta;
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
};

export type ChatCompletionChunk = {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  usage: null;
  system_fingerprint: null;
};
