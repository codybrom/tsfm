import { randomUUID } from "node:crypto";
import type { JsonSchema } from "../schema.js";
import type { ChatCompletionTool, ChatCompletionMessageToolCall } from "./types.js";

export interface ToolParseResult {
  type: "text" | "tool_call";
  content?: string;
  toolCall?: ChatCompletionMessageToolCall;
}

export interface ToolModelOutput {
  type: string;
  tool_call?: { name: string; arguments?: JsonSchema };
  content?: string;
}

/**
 * Generates prompt text describing available tools, appended to existing instructions.
 * The leading newline is intentional.
 */
export function buildToolInstructions(tools: ChatCompletionTool[]): string {
  const toolList: string[] = [];
  for (const tool of tools) {
    const { name, description, parameters } = tool.function;
    toolList.push(`  - name: "${name}"`);
    if (description) toolList.push(`    description: ${description}`);
    toolList.push(`    parameters: ${JSON.stringify(parameters ?? {})}`);
  }

  return [
    "",
    "# Tool Use Instructions",
    "",
    "You have access to external tools. You MUST decide whether to call a tool or respond with text.",
    "",
    "## Available Tools",
    ...toolList,
    "",
    "## Response Rules",
    "1. If the user's request matches ANY tool's purpose, you MUST respond with type \"tool_call\".",
    '2. Only respond with type "text" for general conversation that no tool can help with.',
    "3. Never describe a tool call in text — always use the tool_call structure.",
    "4. Fill in the tool arguments based on the user's request.",
  ].join("\n");
}

/**
 * Builds a JSON schema for structured output that discriminates between
 * a text response and a tool call.
 *
 * All tool parameters are merged into a single `ToolArguments` schema.
 * If multiple tools share the same parameter name, their schemas must be
 * identical — otherwise an error is thrown to prevent silent conflicts.
 *
 * Throws if duplicate tool names are provided or if multiple tools define
 * the same parameter name with different schemas.
 */
export function buildToolSchema(tools: ChatCompletionTool[]): JsonSchema {
  const toolNames = tools.map((t) => t.function.name);

  // Validate tool name uniqueness
  const nameSet = new Set<string>();
  for (const name of toolNames) {
    if (nameSet.has(name)) {
      throw new Error(
        `[tsfm compat] Duplicate tool name "${name}". Each tool must have a unique name.`,
      );
    }
    nameSet.add(name);
  }

  // Build a merged arguments schema from all tools' parameters.
  // Foundation Models requires fully specified schemas — no open-ended objects.
  // Throw when multiple tools define the same property name with different schemas.
  const mergedProperties: Record<string, JsonSchema> = {};
  const seenPropertySources = new Map<string, string>();
  for (const tool of tools) {
    const params = tool.function.parameters;
    if (params && typeof params === "object" && params.properties) {
      const props = params.properties as Record<string, JsonSchema>;
      for (const [key, value] of Object.entries(props)) {
        const prev = seenPropertySources.get(key);
        if (prev !== undefined) {
          const existingSchema = JSON.stringify(mergedProperties[key]);
          const newSchema = JSON.stringify(value);
          if (existingSchema !== newSchema) {
            throw new Error(
              `[tsfm compat] Tool parameter "${key}" is defined by both "${prev}" and "${tool.function.name}" ` +
                `with different schemas. Rename one of the parameters to avoid conflicts.`,
            );
          }
        }
        seenPropertySources.set(key, tool.function.name);
        mergedProperties[key] = value;
      }
    }
  }

  // The AFM schema parser requires nested objects to use $defs/$ref —
  // inline nested objects cause hangs or Code=1041 rejections.
  //
  // x-order controls generation order. Generating type first lets the model
  // commit to "tool_call" before filling out the object. tool_call comes
  // before content so the model fills the structured call instead of dumping
  // tool info into the text content field.
  return {
    $defs: {
      ToolCall: {
        title: "ToolCall",
        type: "object",
        required: ["name", "arguments"],
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            enum: toolNames,
          },
          arguments: {
            $ref: "#/$defs/ToolArguments",
          },
        },
        "x-order": ["name", "arguments"],
      },
      ToolArguments: {
        title: "ToolArguments",
        type: "object",
        properties: mergedProperties,
        required: [] as string[],
        additionalProperties: false,
        "x-order": Object.keys(mergedProperties),
      },
    },
    type: "object",
    required: ["type"],
    additionalProperties: false,
    properties: {
      type: {
        type: "string",
        enum: ["tool_call", "text"],
      },
      tool_call: {
        $ref: "#/$defs/ToolCall",
      },
      content: {
        type: "string",
      },
    },
  };
}

/**
 * Parses the model's structured output into a ToolParseResult.
 */
export function parseToolResponse(parsed: ToolModelOutput): ToolParseResult {
  if (parsed.type === "tool_call") {
    if (parsed.tool_call == null) {
      console.warn(
        `[tsfm compat] Model generated type "tool_call" but the tool_call field is missing. ` +
          `Falling back to an empty text response.`,
      );
      return { type: "text", content: "" };
    }

    const { name, arguments: args = {} } = parsed.tool_call;

    // Ensure arguments is an object before serializing — if the model
    // returns a string or other primitive, wrap it to avoid malformed JSON.
    const normalizedArgs =
      args != null && typeof args === "object" && !Array.isArray(args) ? args : {};

    return {
      type: "tool_call",
      toolCall: {
        id: "call_" + randomUUID(),
        type: "function",
        function: {
          name,
          arguments: JSON.stringify(normalizedArgs),
        },
      },
    };
  }

  return {
    type: "text",
    content: typeof parsed.content === "string" ? parsed.content : "",
  };
}
