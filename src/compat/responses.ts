import { randomUUID } from "node:crypto";
import { LanguageModelSession } from "../session.js";
import { Transcript } from "../transcript.js";
import type { JsonObject } from "../schema.js";
import { SamplingMode, type GenerationOptions } from "../options.js";
import { ownParams } from "./params.js";
import type { Usage } from "../response.js";
import {
  ExceededContextWindowSizeError,
  RefusalError,
  RateLimitedError,
  GuardrailViolationError,
} from "../errors.js";
import {
  buildToolInstructions,
  buildToolSchema,
  parseToolResponse,
  type ToolModelOutput,
} from "./tools.js";
import { ResponseStream } from "./responses-stream.js";
import {
  compatModelName,
  mapReasoningEffort,
  warnOnUnknownModel,
  type CompatModel,
  type CompatModelName,
} from "./models.js";
import {
  reorderJson,
  nowSeconds,
  CompatError,
  describeToolCall,
  formatToolResult,
  toolResultPrompt,
  toResponseUsage,
  type ToolCallRef,
} from "./utils.js";
import type {
  ResponseCreateParams,
  Response,
  ResponseOutputItem,
  ResponseOutputMessage,
  ResponseOutputFunctionToolCall,
  ResponseStreamEvent,
  ResponseInputItem,
  EasyInputMessage,
  FunctionCallOutput,
  ResponseFunctionToolCall,
  FunctionTool,
  ResponseFormatJsonSchema,
} from "./responses-types.js";
import type { ChatCompletionTool } from "./types.js";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TranscriptContentItem {
  type: "text";
  text: string;
  id: string;
}

interface TranscriptEntry {
  role: "instructions" | "user" | "response";
  id: string;
  options?: JsonObject;
  contents: TranscriptContentItem[];
}

interface NativeTranscript {
  type: "FoundationModels.Transcript";
  version: 1;
  transcript: {
    entries: TranscriptEntry[];
  };
}

// ---------------------------------------------------------------------------
// Unsupported params
// ---------------------------------------------------------------------------

const UNSUPPORTED_PARAMS: ReadonlyArray<keyof ResponseCreateParams> = [
  "previous_response_id",
  "conversation",
  "store",
  "truncation",
  "metadata",
  "include",
  "parallel_tool_calls",
  "service_tier",
  "user",
  "stream_options",
  "background",
  "safety_identifier",
  "prompt_cache_key",
  "prompt_cache_retention",
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  return "resp_" + randomUUID();
}

function makeContentItem(text: string): TranscriptContentItem {
  return { type: "text", text, id: randomUUID() };
}

function makeEntry(
  role: TranscriptEntry["role"],
  text: string,
  withOptions = false,
): TranscriptEntry {
  const entry: TranscriptEntry = {
    role,
    id: randomUUID(),
    contents: [makeContentItem(text)],
  };
  if (withOptions) entry.options = {};
  return entry;
}

/** Extract plain text from input content. */
function extractInputText(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  const unsupported = new Set<string>();
  for (const part of content) {
    if (part.type !== "input_text") unsupported.add(part.type);
  }
  for (const type of unsupported) {
    console.warn(
      `[tsfm compat] ${type} content parts are not supported by Apple Foundation Models and will be ignored.`,
    );
  }
  return content
    .filter((p) => p.type === "input_text" && p.text != null)
    .map((p) => p.text as string)
    .join("");
}

/** Map ResponseCreateParams to native GenerationOptions. */
function mapResponseParams(raw: ResponseCreateParams): GenerationOptions {
  const params = ownParams(raw);
  const options: GenerationOptions = {};

  warnOnUnknownModel(params.model);

  const reasoningLevel = mapReasoningEffort(
    params.reasoning ? ownParams(params.reasoning).effort : undefined,
    compatModelName(params.model),
    "reasoning.effort",
  );
  if (reasoningLevel !== undefined) options.reasoningLevel = reasoningLevel;
  if (params.reasoning?.summary != null) {
    console.warn(
      `[tsfm compat] Parameter "reasoning.summary" is not supported and will be ignored.`,
    );
  }

  if (params.temperature != null) options.temperature = params.temperature;
  if (params.max_output_tokens != null) options.maximumResponseTokens = params.max_output_tokens;

  const topP = params.top_p ?? undefined;
  const seed = params.seed ?? undefined;
  if (topP !== undefined || seed !== undefined) {
    options.sampling = SamplingMode.random({
      ...(topP !== undefined ? { probabilityThreshold: topP } : {}),
      ...(seed !== undefined ? { seed } : {}),
    });
  }

  if (params.tool_choice != null && params.tool_choice !== "auto") {
    console.warn(
      `[tsfm compat] Parameter "tool_choice" value "${typeof params.tool_choice === "string" ? params.tool_choice : "object"}" is not supported. ` +
        `Apple Foundation Models always uses "auto" tool selection. The parameter will be ignored.`,
    );
  }

  for (const key of UNSUPPORTED_PARAMS) {
    if (params[key] != null) {
      console.warn(`[tsfm compat] Parameter "${key}" is not supported and will be ignored.`);
    }
  }

  return options;
}

/** Convert Responses API FunctionTool[] to ChatCompletionTool[] for reuse of tool schema logic. */
function toCompletionTools(tools: FunctionTool[]): ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? undefined,
      strict: t.strict,
    },
  }));
}

/**
 * Convert Responses API input (string or item array) into a native transcript
 * JSON string and a prompt string.
 */
function inputToTranscript(
  input: string | ResponseInputItem[],
  instructions?: string | null,
): { transcriptJson: string; prompt: string } {
  // Simple string input
  if (typeof input === "string") {
    const entries: TranscriptEntry[] = [];
    if (instructions) entries.push(makeEntry("instructions", instructions));
    return {
      transcriptJson: JSON.stringify({
        type: "FoundationModels.Transcript",
        version: 1,
        transcript: { entries },
      } satisfies NativeTranscript),
      prompt: input,
    };
  }

  // Array input — find the last user message as prompt
  // Process function_call / function_call_output items specially
  const entries: TranscriptEntry[] = [];
  let seenInstructions = false;

  if (instructions) {
    entries.push(makeEntry("instructions", instructions));
    seenInstructions = true;
  }

  const calls = input.filter(
    (item): item is ResponseFunctionToolCall =>
      (item as ResponseFunctionToolCall).type === "function_call",
  );
  const callFor = (id: string): ToolCallRef | null =>
    calls.findLast((c) => c.call_id === id) ?? null;

  // Normalize: if last item is function_call_output, append a synthetic user message
  let normalized = input;
  const lastItem = input[input.length - 1];
  if (lastItem && (lastItem as FunctionCallOutput).type === "function_call_output") {
    // Collect contiguous function_call_output items from the end
    let start = input.length - 1;
    while (start > 0 && (input[start - 1] as FunctionCallOutput).type === "function_call_output") {
      start--;
    }
    const outputs = input.slice(start) as FunctionCallOutput[];
    const parts: string[] = [];
    for (const out of outputs) {
      parts.push(formatToolResult(callFor(out.call_id), calls, out.output));
    }
    const request = (input.slice(0, start) as EasyInputMessage[]).findLast(
      (m) => m.role === "user",
    );
    const content = toolResultPrompt(parts, request ? extractInputText(request.content) : null);
    normalized = [...input, { role: "user" as const, content } as EasyInputMessage];
  }

  // Find the last user message to use as prompt
  let promptIndex = -1;
  for (let i = normalized.length - 1; i >= 0; i--) {
    const item = normalized[i] as EasyInputMessage;
    if (item.role === "user") {
      promptIndex = i;
      break;
    }
  }

  if (promptIndex === -1) {
    throw new Error("Input must contain at least one user message");
  }

  const promptItem = normalized[promptIndex] as EasyInputMessage;
  const prompt = extractInputText(promptItem.content);

  // Build transcript from all items except the last user message
  for (let i = 0; i < normalized.length; i++) {
    if (i === promptIndex) continue;
    const item = normalized[i];

    if ((item as EasyInputMessage).role !== undefined) {
      const msg = item as EasyInputMessage;
      if (msg.role === "system" || msg.role === "developer") {
        const text = extractInputText(msg.content);
        if (!seenInstructions) {
          entries.push(makeEntry("instructions", text));
          seenInstructions = true;
        } else {
          entries.push(makeEntry("user", `[System] ${text}`, true));
        }
      } else if (msg.role === "user") {
        entries.push(makeEntry("user", extractInputText(msg.content), true));
      } else if (msg.role === "assistant") {
        entries.push(makeEntry("response", extractInputText(msg.content)));
      }
    } else if ((item as ResponseFunctionToolCall).type === "function_call") {
      const fc = item as ResponseFunctionToolCall;
      entries.push(makeEntry("response", describeToolCall(fc.name, fc.arguments)));
    } else if ((item as FunctionCallOutput).type === "function_call_output") {
      const fco = item as FunctionCallOutput;
      entries.push(
        makeEntry("user", formatToolResult(callFor(fco.call_id), calls, fco.output), true),
      );
    }
  }

  return {
    transcriptJson: JSON.stringify({
      type: "FoundationModels.Transcript",
      version: 1,
      transcript: { entries },
    } satisfies NativeTranscript),
    prompt,
  };
}

/** Find a function_call's name by its call_id. */
// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function buildResponse(
  params: ResponseCreateParams,
  output: ResponseOutputItem[],
  status: Response["status"],
  error: { code: string; message: string } | null = null,
  incompleteReason?: "max_output_tokens" | "content_filter",
  usage?: Usage | null,
): Response {
  const outputText = output
    .filter((item): item is ResponseOutputMessage => item.type === "message")
    .flatMap((msg) => msg.content)
    .filter((c) => c.type === "output_text")
    .map((c) => (c as { type: "output_text"; text: string }).text)
    .join("");

  return {
    id: makeId(),
    object: "response",
    created_at: nowSeconds(),
    model: compatModelName(params.model),
    output,
    output_text: outputText,
    status,
    error,
    incomplete_details: incompleteReason ? { reason: incompleteReason } : null,
    instructions: params.instructions ?? null,
    metadata: params.metadata ?? null,
    temperature: params.temperature ?? null,
    top_p: params.top_p ?? null,
    max_output_tokens: params.max_output_tokens ?? null,
    tool_choice: params.tool_choice ?? "auto",
    tools: params.tools ?? [],
    parallel_tool_calls: params.parallel_tool_calls ?? false,
    text: params.text ?? { format: { type: "text" } },
    truncation: params.truncation ?? null,
    usage: usage ? toResponseUsage(usage) : null,
  };
}

function makeOutputMessage(
  content: string,
  status: "completed" | "incomplete" = "completed",
): ResponseOutputMessage {
  return {
    id: "msg_" + randomUUID(),
    type: "message",
    role: "assistant",
    status,
    content: [
      {
        type: "output_text",
        text: content,
        annotations: [],
      },
    ],
  };
}

function makeRefusalMessage(refusal: string): ResponseOutputMessage {
  return {
    id: "msg_" + randomUUID(),
    type: "message",
    role: "assistant",
    status: "completed",
    content: [
      {
        type: "refusal",
        refusal,
      },
    ],
  };
}

function makeFunctionCall(name: string, args: string): ResponseOutputFunctionToolCall {
  return {
    type: "function_call",
    id: "fc_" + randomUUID(),
    call_id: "call_" + randomUUID(),
    name,
    arguments: args,
    status: "completed",
  };
}

// ---------------------------------------------------------------------------
// Responses class
// ---------------------------------------------------------------------------

export class Responses {
  private _getModel: (name: CompatModelName) => CompatModel;

  constructor(getModel: (name: CompatModelName) => CompatModel) {
    this._getModel = getModel;
  }

  async create(params: ResponseCreateParams & { stream: true }): Promise<ResponseStream>;
  async create(params: ResponseCreateParams & { stream?: false | null }): Promise<Response>;
  async create(params: ResponseCreateParams): Promise<Response | ResponseStream>;
  async create(raw: ResponseCreateParams): Promise<Response | ResponseStream> {
    // Own properties only; see ownParams.
    const params = ownParams(raw);
    const options = mapResponseParams(params);
    const { transcriptJson, prompt: rawPrompt } = inputToTranscript(
      params.input,
      params.instructions,
    );
    let prompt = rawPrompt;
    let transcriptStr = transcriptJson;

    // Determine if we should apply tools — skip if last input is a function result
    const functionTools =
      params.tools?.filter((t): t is FunctionTool => t.type === "function") ?? [];
    const lastInput = Array.isArray(params.input) ? params.input[params.input.length - 1] : null;
    const isToolResult =
      lastInput != null && (lastInput as FunctionCallOutput).type === "function_call_output";
    const activeTools = isToolResult ? [] : functionTools;

    // Convert to ChatCompletionTool format for reuse of existing tool logic
    const completionTools = activeTools.length > 0 ? toCompletionTools(activeTools) : undefined;

    // Inject tool instructions
    if (completionTools && completionTools.length > 0) {
      const toolInstructions = buildToolInstructions(completionTools);
      const parsed = JSON.parse(transcriptStr) as NativeTranscript;
      const instrEntry = parsed.transcript.entries.find((e) => e.role === "instructions");
      if (instrEntry) {
        instrEntry.contents[0].text += toolInstructions;
      } else {
        parsed.transcript.entries.unshift({
          role: "instructions",
          id: randomUUID(),
          contents: [makeContentItem(toolInstructions.trimStart())],
        });
      }
      transcriptStr = JSON.stringify(parsed);
      prompt += "\n\nRemember: if a tool can help answer this, use type tool_call.";
    }

    const transcript = Transcript.fromJson(transcriptStr);
    const model = this._getModel(compatModelName(params.model));
    let session: LanguageModelSession;
    try {
      session = LanguageModelSession.fromTranscript(transcript, { model });
    } catch (err) {
      // The transcript owns a native object until a session takes it over;
      // don't leave that to the garbage collector.
      transcript.dispose();
      throw err;
    }

    if (params.stream) {
      return this._createStream(session, prompt, options, params, completionTools);
    }

    return this._createResponse(session, prompt, options, params, completionTools);
  }

  private async _createResponse(
    session: LanguageModelSession,
    prompt: string,
    options: GenerationOptions,
    params: ResponseCreateParams,
    tools?: ChatCompletionTool[],
  ): Promise<Response> {
    try {
      // Tools → structured output with tool schema
      if (tools && tools.length > 0) {
        const schema = buildToolSchema(tools);
        const { content, usage } = await session.respondWithJsonSchema(prompt, schema, {
          options,
        });
        const parsed = JSON.parse(content.toJson()) as ToolModelOutput;
        const result = parseToolResponse(parsed);

        if (result.type === "tool_call" && result.toolCall) {
          const fc = makeFunctionCall(
            result.toolCall.function.name,
            result.toolCall.function.arguments,
          );
          return buildResponse(params, [fc], "completed", null, undefined, usage);
        }
        return buildResponse(
          params,
          [makeOutputMessage(result.content as string)],
          "completed",
          null,
          undefined,
          usage,
        );
      }

      // Structured output via text.format
      const format = params.text?.format;
      if (format?.type === "json_schema") {
        const jsFormat = format as ResponseFormatJsonSchema;
        const schema = jsFormat.schema ?? { type: "object" };
        const { content, usage } = await session.respondWithJsonSchema(prompt, schema, {
          options,
        });
        return buildResponse(
          params,
          [makeOutputMessage(reorderJson(content.toJson(), schema))],
          "completed",
          null,
          undefined,
          usage,
        );
      }

      // Plain text
      const { content, usage } = await session.respond(prompt, { options });
      return buildResponse(
        params,
        [makeOutputMessage(content)],
        "completed",
        null,
        undefined,
        usage,
      );
    } catch (err) {
      if (err instanceof ExceededContextWindowSizeError) {
        return buildResponse(
          params,
          [makeOutputMessage("", "incomplete")],
          "incomplete",
          { code: "max_output_tokens", message: err.message },
          "max_output_tokens",
        );
      }
      if (err instanceof RefusalError) {
        return buildResponse(params, [makeRefusalMessage(err.message)], "completed");
      }
      if (err instanceof RateLimitedError) {
        throw new CompatError(err.message, 429);
      }
      if (err instanceof GuardrailViolationError) {
        return buildResponse(
          params,
          [],
          "failed",
          { code: "content_filter", message: err.message },
          "content_filter",
        );
      }
      throw err;
    } finally {
      session.dispose();
    }
  }

  private _createStream(
    session: LanguageModelSession,
    prompt: string,
    options: GenerationOptions,
    params: ResponseCreateParams,
    tools?: ChatCompletionTool[],
  ): ResponseStream {
    let seq = 0;

    async function* generate(): AsyncGenerator<ResponseStreamEvent> {
      try {
        // response.created
        // OpenAI reports the response as in progress until it completes.
        const initialResponse = buildResponse(params, [], "in_progress");
        yield { type: "response.created", response: initialResponse, sequence_number: seq++ };
        yield { type: "response.in_progress", response: initialResponse, sequence_number: seq++ };

        // Tools → buffer full response
        if (tools && tools.length > 0) {
          const schema = buildToolSchema(tools);
          const { content, usage } = await session.respondWithJsonSchema(prompt, schema, {
            options,
          });
          const parsed = JSON.parse(content.toJson()) as ToolModelOutput;
          const result = parseToolResponse(parsed);

          if (result.type === "tool_call" && result.toolCall) {
            const fc = makeFunctionCall(
              result.toolCall.function.name,
              result.toolCall.function.arguments,
            );

            yield {
              type: "response.output_item.added",
              item: fc,
              output_index: 0,
              sequence_number: seq++,
            };
            yield {
              type: "response.function_call_arguments.delta",
              delta: fc.arguments,
              item_id: fc.id,
              output_index: 0,
              sequence_number: seq++,
            };
            yield {
              type: "response.function_call_arguments.done",
              arguments: fc.arguments,
              name: fc.name,
              call_id: fc.call_id,
              item_id: fc.id,
              output_index: 0,
              sequence_number: seq++,
            };
            yield {
              type: "response.output_item.done",
              item: fc,
              output_index: 0,
              sequence_number: seq++,
            };

            const finalResponse = buildResponse(params, [fc], "completed", null, undefined, usage);
            yield { type: "response.completed", response: finalResponse, sequence_number: seq++ };
            return;
          }

          // Text response from tool schema
          const msg = makeOutputMessage(result.content as string);
          yield* emitTextMessage(msg, 0);
          const finalResponse = buildResponse(params, [msg], "completed", null, undefined, usage);
          yield { type: "response.completed", response: finalResponse, sequence_number: seq++ };
          return;
        }

        // Structured output → buffer
        const format = params.text?.format;
        if (format?.type === "json_schema") {
          const jsFormat = format as ResponseFormatJsonSchema;
          const schema = jsFormat.schema ?? { type: "object" };
          const { content, usage } = await session.respondWithJsonSchema(prompt, schema, {
            options,
          });
          const text = reorderJson(content.toJson(), schema);
          const msg = makeOutputMessage(text);
          yield* emitTextMessage(msg, 0);
          const finalResponse = buildResponse(params, [msg], "completed", null, undefined, usage);
          yield { type: "response.completed", response: finalResponse, sequence_number: seq++ };
          return;
        }

        // Plain text streaming
        const msgId = "msg_" + randomUUID();
        const outputItem: ResponseOutputMessage = {
          id: msgId,
          type: "message",
          role: "assistant",
          status: "in_progress",
          content: [{ type: "output_text", text: "", annotations: [] }],
        };

        yield {
          type: "response.output_item.added",
          item: outputItem,
          output_index: 0,
          sequence_number: seq++,
        };
        yield {
          type: "response.content_part.added",
          part: { type: "output_text", text: "", annotations: [] },
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          sequence_number: seq++,
        };

        let fullText = "";
        const stream = session.streamResponse(prompt, { options });
        for await (const delta of stream) {
          fullText += delta;
          yield {
            type: "response.output_text.delta",
            delta,
            item_id: msgId,
            output_index: 0,
            content_index: 0,
            sequence_number: seq++,
          };
        }

        yield {
          type: "response.output_text.done",
          text: fullText,
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          sequence_number: seq++,
        };
        yield {
          type: "response.content_part.done",
          part: { type: "output_text", text: fullText, annotations: [] },
          item_id: msgId,
          output_index: 0,
          content_index: 0,
          sequence_number: seq++,
        };

        const doneItem: ResponseOutputMessage = {
          id: msgId,
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: fullText, annotations: [] }],
        };
        yield {
          type: "response.output_item.done",
          item: doneItem,
          output_index: 0,
          sequence_number: seq++,
        };

        const finalResponse = buildResponse(
          params,
          [doneItem],
          "completed",
          null,
          undefined,
          stream.usage,
        );
        yield { type: "response.completed", response: finalResponse, sequence_number: seq++ };
      } catch (err) {
        if (err instanceof ExceededContextWindowSizeError) {
          const resp = buildResponse(
            params,
            [],
            "incomplete",
            { code: "max_output_tokens", message: err.message },
            "max_output_tokens",
          );
          yield { type: "response.incomplete", response: resp, sequence_number: seq++ };
          return;
        }
        if (err instanceof RefusalError) {
          const msg = makeRefusalMessage(err.message);
          const resp = buildResponse(params, [msg], "completed");
          yield { type: "response.completed", response: resp, sequence_number: seq++ };
          return;
        }
        if (err instanceof RateLimitedError) {
          throw new CompatError(err.message, 429);
        }
        if (err instanceof GuardrailViolationError) {
          const resp = buildResponse(
            params,
            [],
            "failed",
            { code: "content_filter", message: err.message },
            "content_filter",
          );
          yield { type: "response.failed", response: resp, sequence_number: seq++ };
          return;
        }
        throw err;
      }
    }

    function* emitTextMessage(
      msg: ResponseOutputMessage,
      outputIndex: number,
    ): Generator<ResponseStreamEvent> {
      const textContent = msg.content[0] as {
        type: "output_text";
        text: string;
        annotations: unknown[];
      };
      const text = textContent.text;

      yield {
        type: "response.output_item.added" as const,
        item: msg,
        output_index: outputIndex,
        sequence_number: seq++,
      };
      yield {
        type: "response.content_part.added" as const,
        part: textContent,
        item_id: msg.id,
        output_index: outputIndex,
        content_index: 0,
        sequence_number: seq++,
      };
      yield {
        type: "response.output_text.delta" as const,
        delta: text,
        item_id: msg.id,
        output_index: outputIndex,
        content_index: 0,
        sequence_number: seq++,
      };
      yield {
        type: "response.output_text.done" as const,
        text,
        item_id: msg.id,
        output_index: outputIndex,
        content_index: 0,
        sequence_number: seq++,
      };
      yield {
        type: "response.content_part.done" as const,
        part: textContent,
        item_id: msg.id,
        output_index: outputIndex,
        content_index: 0,
        sequence_number: seq++,
      };
      yield {
        type: "response.output_item.done" as const,
        item: msg,
        output_index: outputIndex,
        sequence_number: seq++,
      };
    }

    return new ResponseStream(generate(), () => session.dispose());
  }
}
