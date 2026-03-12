import { randomUUID } from "node:crypto";
import type { JsonObject } from "../schema.js";
import type { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TranscriptResult {
  /** The native Apple Foundation Models transcript JSON string. */
  transcriptJson: string;
  /** The text of the last user message, excluded from the transcript entries. */
  prompt: string;
}

// ---------------------------------------------------------------------------
// Internal transcript shape
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
// Helpers
// ---------------------------------------------------------------------------

/** Extract plain text from a message content field. */
function extractText(
  content: string | Array<{ type: string; text?: string }> | null | undefined,
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  const unsupported = new Set<string>();
  for (const part of content) {
    if (part.type !== "text") {
      unsupported.add(part.type);
    }
  }
  for (const type of unsupported) {
    console.warn(
      `[tsfm compat] ${type} content parts are not supported by Apple Foundation Models and will be ignored.`,
    );
  }
  return content
    .filter((part) => part.type === "text" && part.text != null)
    .map((part) => part.text as string)
    .join("");
}

/** Build a single transcript content item. */
function makeContent(text: string): TranscriptContentItem {
  return { type: "text", text, id: randomUUID() };
}

/** Build a transcript entry. */
function makeEntry(
  role: TranscriptEntry["role"],
  text: string,
  withOptions = false,
): TranscriptEntry {
  const entry: TranscriptEntry = {
    role,
    id: randomUUID(),
    contents: [makeContent(text)],
  };
  if (withOptions) {
    entry.options = {};
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Convert a Chat-style messages array into the Foundation Models native
 * transcript JSON format.
 *
 * The last user message is excluded from the transcript entries and returned
 * separately as `prompt`.
 */
export function messagesToTranscript(messages: ChatCompletionMessageParam[]): TranscriptResult {
  if (messages.length === 0) {
    throw new Error("messages array must not be empty");
  }

  // When the last message is a tool result (standard tool-calling flow), append
  // a synthetic user message summarizing the tool results so the standard
  // processing can handle it.
  let normalized = messages;
  const last = messages[messages.length - 1];
  if (last.role === "tool") {
    let toolStart = messages.length - 1;
    while (toolStart > 0 && messages[toolStart - 1].role === "tool") {
      toolStart--;
    }
    const toolMessages = messages.slice(toolStart);
    const parts: string[] = [];
    for (const msg of toolMessages) {
      const toolMsg = msg as {
        role: "tool";
        tool_call_id: string;
        content: string | Array<{ type: string; text?: string }>;
      };
      const content = extractText(toolMsg.content);
      const toolName = resolveToolName(toolMsg.tool_call_id, messages);
      parts.push(
        toolName != null
          ? `[Tool result for ${toolName}]: ${content}`
          : `[Tool result]: ${content}`,
      );
    }
    normalized = [...messages, { role: "user" as const, content: parts.join("\n") }];
  }

  const lastMsg = normalized[normalized.length - 1];
  if (lastMsg.role !== "user") {
    throw new Error(`Last message must have role "user", got "${lastMsg.role}"`);
  }

  // Separate the last user message from the history
  const history = normalized.slice(0, -1);
  const prompt = extractText(
    (lastMsg as { role: "user"; content: string | Array<{ type: string; text?: string }> }).content,
  );

  const entries: TranscriptEntry[] = [];
  let seenSystemOrDeveloper = false;

  for (const msg of history) {
    if (msg.role === "system" || msg.role === "developer") {
      const text = extractText(msg.content);
      if (!seenSystemOrDeveloper) {
        entries.push(makeEntry("instructions", text));
        seenSystemOrDeveloper = true;
      } else {
        entries.push(makeEntry("user", `[System] ${text}`, true));
      }
    } else if (msg.role === "user") {
      const text = extractText(msg.content);
      entries.push(makeEntry("user", text, true));
    } else if (msg.role === "assistant") {
      let text: string;
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        text = JSON.stringify(msg.tool_calls);
      } else {
        text = extractText(msg.content);
      }
      entries.push(makeEntry("response", text));
    } else if (msg.role === "tool") {
      const toolMsg = msg as {
        role: "tool";
        tool_call_id: string;
        content: string | Array<{ type: string; text?: string }>;
      };
      const content = extractText(toolMsg.content);
      const toolName = resolveToolName(toolMsg.tool_call_id, history);
      const text =
        toolName != null
          ? `[Tool result for ${toolName}]: ${content}`
          : `[Tool result]: ${content}`;
      entries.push(makeEntry("user", text, true));
    }
  }

  const native: NativeTranscript = {
    type: "FoundationModels.Transcript",
    version: 1,
    transcript: { entries },
  };

  return { transcriptJson: JSON.stringify(native), prompt };
}

// ---------------------------------------------------------------------------
// Tool name resolution
// ---------------------------------------------------------------------------

/** Scan backward through messages to find the tool name for a given call ID. */
function resolveToolName(
  toolCallId: string,
  messages: ChatCompletionMessageParam[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "assistant" && msg.tool_calls) {
      const match = (msg.tool_calls as ChatCompletionMessageToolCall[]).find(
        (tc) => tc.id === toolCallId,
      );
      if (match) return match.function.name;
    }
  }
  return null;
}
