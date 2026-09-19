import { randomUUID } from "node:crypto";
import { SystemLanguageModel } from "../core.js";
import { PrivateCloudComputeLanguageModel } from "../pcc.js";
import { LanguageModelSession } from "../session.js";
import { Transcript } from "../transcript.js";
import type { JsonSchema, JsonObject } from "../schema.js";
import type { GenerationOptions } from "../options.js";
import { emptyUsage, usageBetween, type ResponseStream, type Usage } from "../response.js";
import {
  ExceededContextWindowSizeError,
  RefusalError,
  RateLimitedError,
  GuardrailViolationError,
} from "../errors.js";
import { messagesToTranscript } from "./transcript.js";
import { mapParams } from "./params.js";
import {
  buildToolInstructions,
  buildToolSchema,
  parseToolResponse,
  type ToolModelOutput,
} from "./tools.js";
import { Stream } from "./stream.js";
import { Responses } from "./responses.js";
import {
  SYSTEM_MODEL,
  PCC_MODEL,
  compatModelName,
  type CompatModel,
  type CompatModelName,
} from "./models.js";
import { reorderJson, nowSeconds, CompatError, toCompletionUsage } from "./utils.js";
import type {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionTool,
} from "./types.js";

export { Stream } from "./stream.js";
export { ResponseStream } from "./responses-stream.js";
export { Responses } from "./responses.js";
export * from "./types.js";
export * from "./responses-types.js";

export const MODEL_DEFAULT = SYSTEM_MODEL;
export { SYSTEM_MODEL, PCC_MODEL, type CompatModelName } from "./models.js";

/** Returns the model instance for a model name. */
type ModelProvider = (name: CompatModelName) => CompatModel;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TranscriptJson {
  type: string;
  version: number;
  transcript: {
    entries: Array<{
      role: string;
      id: string;
      contents: Array<{ type: string; text: string; id: string }>;
      options?: JsonObject;
    }>;
  };
}

function makeId(): string {
  return "chatcmpl-" + randomUUID();
}

// ---------------------------------------------------------------------------
// Nested helper classes
// ---------------------------------------------------------------------------

class Completions {
  private _getModel: ModelProvider;

  constructor(getModel: ModelProvider) {
    this._getModel = getModel;
  }

  /**
   * Create a chat completion, mirroring the `chat.completions.create()` API.
   *
   * Supported params are mapped to native GenerationOptions; unsupported params
   * (e.g. `n`, `logprobs`, `tool_choice`) are warned and ignored. See
   * `mapParams()` for the full mapping. Sessions are created and disposed
   * automatically per call.
   *
   * Native errors are mapped to standard responses:
   * - `ExceededContextWindowSizeError` → `finish_reason: "length"`
   * - `GuardrailViolationError` → `finish_reason: "content_filter"`
   * - `RefusalError` → `message.refusal` with `content: null`
   * - `RateLimitedError` → thrown with `status: 429`
   */
  async create(params: ChatCompletionCreateParams & { stream: true }): Promise<Stream>;
  async create(
    params: ChatCompletionCreateParams & { stream?: false | null },
  ): Promise<ChatCompletion>;
  async create(params: ChatCompletionCreateParams): Promise<ChatCompletion | Stream>;
  async create(params: ChatCompletionCreateParams): Promise<ChatCompletion | Stream> {
    const options = mapParams(params);
    const { transcriptJson, prompt: rawPrompt } = messagesToTranscript(params.messages);
    let prompt = rawPrompt;
    let transcriptStr = transcriptJson;

    // When the last message is a tool result, the tool already ran — the model
    // should respond with plain text incorporating the result, not try to call
    // tools again. Only enable tool-calling structured output for the initial
    // request (last message is "user", not "tool").
    const lastMsg = params.messages[params.messages.length - 1];
    const tools = lastMsg.role === "tool" ? undefined : params.tools;

    // Inject tool instructions into the transcript's instructions entry
    if (tools && tools.length > 0) {
      const toolInstructions = buildToolInstructions(tools);
      const parsed = JSON.parse(transcriptStr) as TranscriptJson;
      const instructionsEntry = parsed.transcript.entries.find((e) => e.role === "instructions");
      if (instructionsEntry) {
        instructionsEntry.contents[0].text += toolInstructions;
      } else {
        parsed.transcript.entries.unshift({
          role: "instructions",
          id: randomUUID(),
          contents: [{ type: "text", text: toolInstructions.trimStart(), id: randomUUID() }],
        });
      }
      transcriptStr = JSON.stringify(parsed);
    }

    // Append JSON instruction to prompt for json_object mode
    if (params.response_format?.type === "json_object") {
      prompt += "\n\nRespond with valid JSON only. No other text.";
    }

    // Remind the model to use tools when they're available
    if (tools && tools.length > 0) {
      prompt += "\n\nRemember: if a tool can help answer this, use type tool_call.";
    }

    // Create session from transcript
    const transcript = Transcript.fromJson(transcriptStr);
    const modelName = compatModelName(params.model);
    const model = this._getModel(modelName);
    const session = LanguageModelSession.fromTranscript(transcript, { model });

    if (params.stream) {
      const includeUsage = params.stream_options?.include_usage === true;
      return this._createStream(session, prompt, options, modelName, includeUsage, tools);
    }

    const completion = await this._createCompletion(session, prompt, options, params, tools);
    return { ...completion, model: modelName };
  }

  private async _createCompletion(
    session: LanguageModelSession,
    prompt: string,
    options: GenerationOptions,
    params: ChatCompletionCreateParams,
    tools?: ChatCompletionTool[],
  ): Promise<ChatCompletion> {
    try {
      // Tools present → use structured output with tool schema
      if (tools && tools.length > 0) {
        const schema = buildToolSchema(tools);
        const { content, usage } = await session.respondWithJsonSchema(prompt, schema, {
          options,
        });
        const parsed = JSON.parse(content.toJson()) as ToolModelOutput;
        const result = parseToolResponse(parsed);

        if (result.type === "tool_call" && result.toolCall) {
          return buildCompletion(null, "tool_calls", [result.toolCall], usage);
        }
        return buildCompletion(result.content as string, "stop", undefined, usage);
      }

      // json_schema response format
      if (params.response_format?.type === "json_schema") {
        const rf = params.response_format as {
          type: "json_schema";
          json_schema: { schema?: JsonSchema };
        };
        const schema = rf.json_schema.schema ?? { type: "object" };
        const { content, usage } = await session.respondWithJsonSchema(prompt, schema, {
          options,
        });
        return buildCompletion(reorderJson(content.toJson(), schema), "stop", undefined, usage);
      }

      // Plain text
      const { content, usage } = await session.respond(prompt, { options });
      return buildCompletion(content, "stop", undefined, usage);
    } catch (err) {
      if (err instanceof ExceededContextWindowSizeError) {
        return buildCompletion("", "length");
      }
      if (err instanceof RefusalError) {
        return {
          ...buildCompletion(null, "stop"),
          choices: [
            {
              index: 0,
              message: {
                role: "assistant" as const,
                content: null,
                refusal: err.message,
              },
              finish_reason: "stop" as const,
            },
          ],
        };
      }
      if (err instanceof RateLimitedError) {
        throw new CompatError(err.message, 429);
      }
      if (err instanceof GuardrailViolationError) {
        return buildCompletion(null, "content_filter");
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
    modelName: CompatModelName,
    includeUsage: boolean,
    tools?: ChatCompletionTool[],
  ): Stream {
    const id = makeId();
    const created = nowSeconds();
    const chunk = (
      delta: ChatCompletionChunk["choices"][0]["delta"],
      finishReason: ChatCompletionChunk["choices"][0]["finish_reason"],
    ): ChatCompletionChunk => ({
      ...makeChunk(id, created, delta, finishReason),
      model: modelName,
    });

    // The request's usage, once known. A text stream sets it even when it
    // ends with an error that maps to a finish_reason.
    let usage: Usage | undefined;

    async function* generate(): AsyncGenerator<ChatCompletionChunk> {
      yield* generateChoices();
      if (includeUsage) {
        yield {
          ...chunk({}, null),
          choices: [],
          usage: toCompletionUsage(usage ?? emptyUsage()),
        };
      }
    }

    async function* generateChoices(): AsyncGenerator<ChatCompletionChunk> {
      let stream: ResponseStream | undefined;
      // A buffered (tool) request that throws returns no Response, so its usage
      // is the change in the session's cumulative usage around it.
      let bufferedUsageBefore: Usage | undefined;
      try {
        // First chunk: role announcement
        yield chunk({ role: "assistant", content: "" }, null);

        // Tools or structured output with streaming: buffer the full response
        if (tools && tools.length > 0) {
          const schema = buildToolSchema(tools);
          bufferedUsageBefore = session.usage;
          const response = await session.respondWithJsonSchema(prompt, schema, { options });
          usage = response.usage;
          const parsed = JSON.parse(response.content.toJson()) as ToolModelOutput;
          const result = parseToolResponse(parsed);

          if (result.type === "tool_call" && result.toolCall) {
            yield chunk(
              {
                tool_calls: [
                  {
                    index: 0,
                    id: result.toolCall.id,
                    type: "function",
                    function: {
                      name: result.toolCall.function.name,
                      arguments: result.toolCall.function.arguments,
                    },
                  },
                ],
              },
              null,
            );
            yield chunk({}, "tool_calls");
          } else {
            yield chunk({ content: result.content as string }, null);
            yield chunk({}, "stop");
          }
          return;
        }

        // Plain text streaming
        stream = session.streamResponse(prompt, { options });
        for await (const delta of stream) {
          yield chunk({ content: delta }, null);
        }
        usage = stream.usage;

        // Final chunk
        yield chunk({}, "stop");
      } catch (err) {
        usage =
          stream?.usage ??
          (bufferedUsageBefore ? usageBetween(bufferedUsageBefore, session.usage) : undefined);
        // Map errors to finish_reason chunks
        if (err instanceof ExceededContextWindowSizeError) {
          yield chunk({}, "length");
          return;
        }
        if (err instanceof RefusalError) {
          yield chunk({ refusal: err.message }, null);
          yield chunk({}, "stop");
          return;
        }
        if (err instanceof RateLimitedError) {
          throw new CompatError(err.message, 429);
        }
        if (err instanceof GuardrailViolationError) {
          yield chunk({}, "content_filter");
          return;
        }
        throw err;
      }
    }

    return new Stream(generate(), () => session.dispose());
  }
}

class Chat {
  completions: Completions;

  constructor(getModel: ModelProvider) {
    this.completions = new Completions(getModel);
  }
}

// ---------------------------------------------------------------------------
// Main Client class
// ---------------------------------------------------------------------------

/**
 * Chat-style and Responses-style API client backed by Apple Foundation Models
 * on-device inference.
 *
 * Supports both `chat.completions.create()` (Chat-style API) and
 * `responses.create()` (Responses-style API) with text, streaming, structured
 * output, and tool calling. Each call is stateless: the input is replayed
 * into a native transcript, generation runs, and the session is auto-disposed.
 *
 * Requests use the on-device model unless `model` is
 * `"PrivateCloudComputeLanguageModel"`, which needs Apple's PCC entitlement on
 * the host process (see the Private Cloud Compute guide).
 *
 * Call `close()` when done to release the underlying models.
 */
export default class Client {
  chat: Chat;
  responses: Responses;
  private _model: SystemLanguageModel;
  private _pccModel: PrivateCloudComputeLanguageModel | null = null;

  constructor() {
    this._model = new SystemLanguageModel();
    const getModel: ModelProvider = (name) => (name === PCC_MODEL ? this._pcc() : this._model);
    this.chat = new Chat(getModel);
    this.responses = new Responses(getModel);
  }

  /** Created on first use, so clients that stay on-device never touch PCC. */
  private _pcc(): PrivateCloudComputeLanguageModel {
    this._pccModel ??= new PrivateCloudComputeLanguageModel();
    return this._pccModel;
  }

  close(): void {
    this._model.dispose();
    this._pccModel?.dispose();
    this._pccModel = null;
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

// ---------------------------------------------------------------------------
// Response builders
// ---------------------------------------------------------------------------

function buildCompletion(
  content: string | null,
  finishReason: "stop" | "length" | "tool_calls" | "content_filter",
  toolCalls?: ChatCompletion["choices"][0]["message"]["tool_calls"],
  usage?: Usage,
): ChatCompletion {
  return {
    id: makeId(),
    object: "chat.completion",
    created: nowSeconds(),
    model: MODEL_DEFAULT,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          refusal: null,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage: usage ? toCompletionUsage(usage) : null,
    system_fingerprint: null,
  };
}

function makeChunk(
  id: string,
  created: number,
  delta: ChatCompletionChunk["choices"][0]["delta"],
  finishReason: ChatCompletionChunk["choices"][0]["finish_reason"],
): ChatCompletionChunk {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model: MODEL_DEFAULT,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: finishReason,
      },
    ],
    usage: null,
    system_fingerprint: null,
  };
}
