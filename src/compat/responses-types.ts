// Responses API type definitions for the Apple Foundation Models compat layer.
// This is a pure types file with no runtime code.

import type { JsonSchema } from "../schema.js";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type ResponseInputText = {
  type: "input_text";
  text: string;
};

export type ResponseInputImage = {
  type: "input_image";
  image_url?: string;
  file_id?: string;
  detail?: "low" | "high" | "auto";
};

export type ResponseInputFile = {
  type: "input_file";
  file_data?: string;
  file_id?: string;
  filename?: string;
};

export type ResponseInputContent = ResponseInputText | ResponseInputImage | ResponseInputFile;

export type EasyInputMessage = {
  role: "user" | "assistant" | "system" | "developer";
  content: string | ResponseInputContent[];
  type?: "message";
  name?: string;
};

export type ResponseFunctionToolCall = {
  type: "function_call";
  name: string;
  arguments: string;
  call_id: string;
  id?: string;
  status?: "in_progress" | "completed" | "incomplete";
};

export type FunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
  id?: string | null;
};

export type ResponseInputItem = EasyInputMessage | ResponseFunctionToolCall | FunctionCallOutput;

// ---------------------------------------------------------------------------
// Tool types
// ---------------------------------------------------------------------------

export type FunctionTool = {
  type: "function";
  name: string;
  parameters: JsonSchema | null;
  description?: string;
  strict?: boolean | null;
};

export type ResponseTool = FunctionTool;

// ---------------------------------------------------------------------------
// Structured output (text.format)
// ---------------------------------------------------------------------------

export type ResponseFormatText = { type: "text" };

export type ResponseFormatJsonObject = { type: "json_object" };

export type ResponseFormatJsonSchema = {
  type: "json_schema";
  name: string;
  schema: JsonSchema;
  description?: string;
  strict?: boolean | null;
};

export type ResponseFormatConfig =
  | ResponseFormatText
  | ResponseFormatJsonObject
  | ResponseFormatJsonSchema;

export type ResponseTextConfig = {
  format?: ResponseFormatConfig;
};

// ---------------------------------------------------------------------------
// Request params
// ---------------------------------------------------------------------------

/**
 * Request params for `responses.create()`.
 *
 * All Responses API params are accepted for type compatibility. Supported
 * params are mapped to Foundation Models GenerationOptions; unsupported params
 * are warned and silently ignored at runtime.
 */
export type ResponseCreateParams = {
  // Core
  input: string | ResponseInputItem[];
  model?: string;
  instructions?: string | null;

  // Sampling
  temperature?: number | null;
  top_p?: number | null;
  max_output_tokens?: number | null;

  // Tools
  tools?: ResponseTool[];
  tool_choice?: "none" | "auto" | "required" | { type: "function"; name: string };

  // Structured output
  text?: ResponseTextConfig;

  // Streaming
  stream?: boolean | null;

  // Accepted but ignored
  previous_response_id?: string | null;
  conversation?: string | { id: string } | null;
  store?: boolean | null;
  truncation?: "auto" | "disabled" | null;
  metadata?: Record<string, string> | null;
  include?: string[] | null;
  reasoning?: { effort?: string; summary?: string | null } | null;
  parallel_tool_calls?: boolean | null;
  service_tier?: string | null;
  user?: string;
  seed?: number | null;
  stream_options?: { include_obfuscation?: boolean } | null;
  background?: boolean | null;
  safety_identifier?: string;
  prompt_cache_key?: string;
  prompt_cache_retention?: string | null;
};

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ResponseOutputText = {
  type: "output_text";
  text: string;
  annotations: unknown[];
};

export type ResponseOutputRefusal = {
  type: "refusal";
  refusal: string;
};

export type ResponseOutputContent = ResponseOutputText | ResponseOutputRefusal;

export type ResponseOutputMessage = {
  id: string;
  type: "message";
  role: "assistant";
  status: "completed" | "incomplete" | "in_progress";
  content: ResponseOutputContent[];
};

export type ResponseOutputFunctionToolCall = {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status: "completed";
};

export type ResponseOutputItem = ResponseOutputMessage | ResponseOutputFunctionToolCall;

// ---------------------------------------------------------------------------
// Response object
// ---------------------------------------------------------------------------

export type ResponseError = {
  code: string;
  message: string;
};

export type Response = {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  output: ResponseOutputItem[];
  output_text: string;
  status: "completed" | "failed" | "incomplete";
  error: ResponseError | null;
  incomplete_details: { reason?: "max_output_tokens" | "content_filter" } | null;
  instructions: string | null;
  metadata: Record<string, string> | null;
  temperature: number | null;
  top_p: number | null;
  max_output_tokens: number | null;
  tool_choice: "none" | "auto" | "required" | { type: "function"; name: string };
  tools: ResponseTool[];
  parallel_tool_calls: boolean;
  text: ResponseTextConfig;
  truncation: "auto" | "disabled" | null;
  usage: null;
};

// ---------------------------------------------------------------------------
// Streaming event types
// ---------------------------------------------------------------------------

export type ResponseCreatedEvent = {
  type: "response.created";
  response: Response;
  sequence_number: number;
};

export type ResponseInProgressEvent = {
  type: "response.in_progress";
  response: Response;
  sequence_number: number;
};

export type ResponseCompletedEvent = {
  type: "response.completed";
  response: Response;
  sequence_number: number;
};

export type ResponseFailedEvent = {
  type: "response.failed";
  response: Response;
  sequence_number: number;
};

export type ResponseIncompleteEvent = {
  type: "response.incomplete";
  response: Response;
  sequence_number: number;
};

export type ResponseOutputItemAddedEvent = {
  type: "response.output_item.added";
  item: ResponseOutputItem;
  output_index: number;
  sequence_number: number;
};

export type ResponseOutputItemDoneEvent = {
  type: "response.output_item.done";
  item: ResponseOutputItem;
  output_index: number;
  sequence_number: number;
};

export type ResponseContentPartAddedEvent = {
  type: "response.content_part.added";
  part: ResponseOutputContent;
  item_id: string;
  output_index: number;
  content_index: number;
  sequence_number: number;
};

export type ResponseContentPartDoneEvent = {
  type: "response.content_part.done";
  part: ResponseOutputContent;
  item_id: string;
  output_index: number;
  content_index: number;
  sequence_number: number;
};

export type ResponseTextDeltaEvent = {
  type: "response.output_text.delta";
  delta: string;
  item_id: string;
  output_index: number;
  content_index: number;
  sequence_number: number;
};

export type ResponseTextDoneEvent = {
  type: "response.output_text.done";
  text: string;
  item_id: string;
  output_index: number;
  content_index: number;
  sequence_number: number;
};

export type ResponseRefusalDeltaEvent = {
  type: "response.refusal.delta";
  delta: string;
  item_id: string;
  output_index: number;
  content_index: number;
  sequence_number: number;
};

export type ResponseRefusalDoneEvent = {
  type: "response.refusal.done";
  refusal: string;
  item_id: string;
  output_index: number;
  content_index: number;
  sequence_number: number;
};

export type ResponseFunctionCallArgumentsDeltaEvent = {
  type: "response.function_call_arguments.delta";
  delta: string;
  item_id: string;
  output_index: number;
  sequence_number: number;
};

export type ResponseFunctionCallArgumentsDoneEvent = {
  type: "response.function_call_arguments.done";
  arguments: string;
  name: string;
  call_id: string;
  item_id: string;
  output_index: number;
  sequence_number: number;
};

export type ResponseStreamEvent =
  | ResponseCreatedEvent
  | ResponseInProgressEvent
  | ResponseCompletedEvent
  | ResponseFailedEvent
  | ResponseIncompleteEvent
  | ResponseOutputItemAddedEvent
  | ResponseOutputItemDoneEvent
  | ResponseContentPartAddedEvent
  | ResponseContentPartDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseRefusalDeltaEvent
  | ResponseRefusalDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent;
