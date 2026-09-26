import type { JsonSchema, JsonObject } from "../schema.js";
import type { Usage } from "../response.js";
import type { CompletionUsage } from "./types.js";
import type { ResponseUsage } from "./responses-types.js";
import {
  RateLimitedError,
  PrivateCloudComputeQuotaExceededError,
  PrivateCloudComputeUnavailableError,
  PrivateCloudComputeNetworkError,
  PrivateCloudComputeEntitlementError,
  SystemPressureError,
  ServiceCrashedError,
} from "../errors.js";

/**
 * Reorder JSON keys to match the property order defined in a JSON schema.
 * Other AI APIs return keys in schema-defined order. Foundation Models returns them in
 * generation order. This normalizes the output for compatibility.
 */
export function reorderJson(json: string, schema: JsonSchema): string {
  try {
    const obj = JSON.parse(json);
    return JSON.stringify(orderKeys(obj, schema));
  } catch (err) {
    console.warn("[tsfm compat] Failed to reorder JSON keys, returning original:", err);
    return json;
  }
}

export function orderKeys(value: JsonObject[string], schema: JsonSchema): JsonObject[string] {
  if (value == null || typeof value !== "object") return value;

  // Handle arrays: reorder keys inside each element using schema.items
  if (Array.isArray(value)) {
    const itemSchema = schema.items as JsonSchema | undefined;
    if (itemSchema && typeof itemSchema === "object" && !Array.isArray(itemSchema)) {
      return value.map((el) => orderKeys(el, itemSchema)) as JsonObject[];
    }
    return value;
  }

  const props = schema.properties as Record<string, JsonSchema> | undefined;
  if (!props) return value;

  const obj = value as JsonObject;
  const ordered: JsonObject = {};

  // First, add keys in schema property order
  for (const key of Object.keys(props)) {
    if (key in obj) {
      ordered[key] = orderKeys(obj[key], props[key]);
    }
  }
  // Then any extra keys not in schema (shouldn't happen with strict schemas)
  for (const key of Object.keys(obj)) {
    if (!(key in ordered)) {
      ordered[key] = obj[key];
    }
  }
  return ordered;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class CompatError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CompatError";
    this.status = status;
  }
}

/**
 * The HTTP status an SDK error should surface as, or null when it has no
 * counterpart and the caller should handle it another way.
 *
 * Both compat layers share this: mapping them separately let the Private
 * Cloud Compute errors reach only one of the two, so a quota a client could
 * back off from answered 500 instead of 429.
 */
export function compatStatusFor(err: unknown): number | null {
  if (err instanceof RateLimitedError || err instanceof PrivateCloudComputeQuotaExceededError) {
    return 429;
  }
  // The system can't run the model right now, or a system service crashed and
  // macOS is restarting it. Both clear on their own, so a client should retry.
  if (
    err instanceof PrivateCloudComputeUnavailableError ||
    err instanceof PrivateCloudComputeNetworkError ||
    err instanceof SystemPressureError ||
    err instanceof ServiceCrashedError
  ) {
    return 503;
  }
  // The host process isn't signed for PCC: a configuration problem, not a
  // transient one, so it must not read as retryable.
  if (err instanceof PrivateCloudComputeEntitlementError) return 403;
  return null;
}

/** Rethrows `err` as a CompatError when it has an HTTP counterpart. */
export function throwAsCompatError(err: unknown): void {
  const status = compatStatusFor(err);
  if (status !== null) throw new CompatError((err as Error).message, status);
}

/**
 * Render a past tool call as a transcript response entry.
 *
 * Plain text rather than the OpenAI JSON shape: given a raw tool_calls array in
 * its history, the model tends to echo that JSON back as its final answer.
 */
export function describeToolCall(name: string, args: string): string {
  return `Calling ${name} with ${args}.`;
}

/**
 * Build the prompt for a request that ends in tool results.
 *
 * The results alone read as a new, unrelated user turn, and the model often
 * answers something else. Restating the request that led to the tool call
 * keeps the reply on it.
 */
export function toolResultPrompt(results: string[], request: string | null): string {
  const text = results.join("\n");
  return request ? `${text}\n\nUse the tool result to respond to the request: ${request}` : text;
}

/** The name and arguments of a past tool call, as both compat APIs record them. */
export interface ToolCallRef {
  name: string;
  arguments: string;
}

/**
 * Label a tool result with the call that produced it.
 *
 * When a tool was called more than once, the name alone cannot tell the model
 * which result belongs to which call, so the label adds the call's arguments.
 * Call IDs are left out: the model cannot use them, and it echoes them back.
 */
export function formatToolResult(
  call: ToolCallRef | null,
  allCalls: ToolCallRef[],
  content: string,
): string {
  if (!call) return `[Tool result]: ${content}`;
  const repeated = allCalls.filter((c) => c.name === call.name).length > 1;
  const label = repeated ? `${call.name} ${call.arguments}` : call.name;
  return `[Tool result for ${label}]: ${content}`;
}

/** tsfm usage in OpenAI's Chat Completions shape. */
export function toCompletionUsage(usage: Usage): CompletionUsage {
  return {
    prompt_tokens: usage.input.totalTokens,
    completion_tokens: usage.output.totalTokens,
    total_tokens: usage.input.totalTokens + usage.output.totalTokens,
    prompt_tokens_details: { cached_tokens: usage.input.cachedTokens },
    completion_tokens_details: { reasoning_tokens: usage.output.reasoningTokens },
  };
}

/** tsfm usage in OpenAI's Responses shape. */
export function toResponseUsage(usage: Usage): ResponseUsage {
  return {
    input_tokens: usage.input.totalTokens,
    input_tokens_details: { cached_tokens: usage.input.cachedTokens },
    output_tokens: usage.output.totalTokens,
    output_tokens_details: { reasoning_tokens: usage.output.reasoningTokens },
    total_tokens: usage.input.totalTokens + usage.output.totalTokens,
  };
}
