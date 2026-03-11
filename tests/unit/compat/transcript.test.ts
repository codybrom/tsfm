import { describe, it, expect, vi } from "vitest";
import { messagesToTranscript } from "../../../src/compat/transcript.js";
import type { ChatCompletionMessageParam } from "../../../src/compat/types.js";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("messagesToTranscript", () => {
  // 1. Single user message → empty entries, prompt set
  it("single user message returns empty entries and sets prompt", () => {
    const messages: ChatCompletionMessageParam[] = [{ role: "user", content: "Hello" }];
    const result = messagesToTranscript(messages);
    expect(result.prompt).toBe("Hello");
    const parsed = JSON.parse(result.transcriptJson);
    expect(parsed.transcript.entries).toHaveLength(0);
  });

  // 2. System message → instructions entry
  it("system message becomes instructions entry", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "You are a helper." },
      { role: "user", content: "Hi" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    expect(parsed.transcript.entries).toHaveLength(1);
    const entry = parsed.transcript.entries[0];
    expect(entry.role).toBe("instructions");
    expect(entry.contents[0].text).toBe("You are a helper.");
    expect(result.prompt).toBe("Hi");
  });

  // 3. Developer role → same as system
  it("developer role is treated the same as system", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "developer", content: "You are a dev assistant." },
      { role: "user", content: "Hey" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const entry = parsed.transcript.entries[0];
    expect(entry.role).toBe("instructions");
    expect(entry.contents[0].text).toBe("You are a dev assistant.");
  });

  // 4. Multiple system messages → first is instructions, rest are user with [System] prefix
  it("subsequent system messages become user entries with [System] prefix", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "First system." },
      { role: "system", content: "Second system." },
      { role: "user", content: "Hello" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    expect(parsed.transcript.entries).toHaveLength(2);
    expect(parsed.transcript.entries[0].role).toBe("instructions");
    expect(parsed.transcript.entries[1].role).toBe("user");
    expect(parsed.transcript.entries[1].contents[0].text).toBe("[System] Second system.");
  });

  // 5. Multi-turn conversation (user/assistant/user)
  it("multi-turn conversation maps correctly", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "What is 2+2?" },
      { role: "assistant", content: "4" },
      { role: "user", content: "And 3+3?" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    expect(parsed.transcript.entries).toHaveLength(2);
    expect(parsed.transcript.entries[0].role).toBe("user");
    expect(parsed.transcript.entries[0].contents[0].text).toBe("What is 2+2?");
    expect(parsed.transcript.entries[1].role).toBe("response");
    expect(parsed.transcript.entries[1].contents[0].text).toBe("4");
    expect(result.prompt).toBe("And 3+3?");
  });

  // 6. Assistant with tool_calls → response with stringified tool_calls
  it("assistant with tool_calls stringifies the tool_calls as content", () => {
    const toolCalls = [
      { id: "call_1", type: "function" as const, function: { name: "myFn", arguments: "{}" } },
    ];
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Do something" },
      { role: "assistant", content: null, tool_calls: toolCalls },
      { role: "user", content: "Next" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const assistantEntry = parsed.transcript.entries[1];
    expect(assistantEntry.role).toBe("response");
    expect(assistantEntry.contents[0].text).toBe(JSON.stringify(toolCalls));
  });

  // 7. Tool message → user entry with resolved tool name
  it("tool message resolves name from previous assistant tool_calls", () => {
    const toolCalls = [
      {
        id: "call_abc",
        type: "function" as const,
        function: { name: "getWeather", arguments: "{}" },
      },
    ];
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "What's the weather?" },
      { role: "assistant", content: null, tool_calls: toolCalls },
      { role: "tool", tool_call_id: "call_abc", content: "Sunny, 72°F" },
      { role: "user", content: "Thanks" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const toolEntry = parsed.transcript.entries[2];
    expect(toolEntry.role).toBe("user");
    expect(toolEntry.contents[0].text).toBe("[Tool result for getWeather]: Sunny, 72°F");
  });

  // 8. Tool message with unresolvable tool_call_id → fallback format
  it("tool message with unresolvable tool_call_id uses fallback format", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Do something" },
      { role: "tool", tool_call_id: "unknown_id", content: "some result" },
      { role: "user", content: "OK" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const toolEntry = parsed.transcript.entries[1];
    expect(toolEntry.role).toBe("user");
    expect(toolEntry.contents[0].text).toBe("[Tool result]: some result");
  });

  // 9. Multi-part content arrays → extract text only
  it("multi-part content arrays concatenate only text parts", () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello " },
          { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          { type: "text", text: "world" },
        ],
      },
    ];
    const result = messagesToTranscript(messages);
    expect(result.prompt).toBe("Hello world");
  });

  it("multi-part content in non-last user message extracts text parts", () => {
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Part one " },
          { type: "image_url", image_url: { url: "https://example.com/img.png" } },
          { type: "text", text: "part two" },
        ],
      },
      { role: "assistant", content: "Got it" },
      { role: "user", content: "Follow up" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    expect(parsed.transcript.entries[0].contents[0].text).toBe("Part one part two");
  });

  // 10. Unique UUIDs on entries
  it("every entry and content item has a unique UUID", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "system", content: "Instructions" },
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Bye" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const ids: string[] = [];
    for (const entry of parsed.transcript.entries) {
      expect(isUuid(entry.id)).toBe(true);
      ids.push(entry.id);
      for (const content of entry.contents) {
        expect(isUuid(content.id)).toBe(true);
        ids.push(content.id);
      }
    }
    // All IDs are unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  // 11. Empty messages → throws
  it("throws on empty messages array", () => {
    expect(() => messagesToTranscript([])).toThrow();
  });

  // 12. Last message not user (and not tool) → throws
  it("throws when last message is not role user or tool", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello" },
    ];
    expect(() => messagesToTranscript(messages)).toThrow();
  });

  // 13. Tool as last message → synthesizes user prompt from tool results
  it("handles tool as last message by synthesizing user prompt", () => {
    const toolCalls = [
      {
        id: "call_123",
        type: "function" as const,
        function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
      },
    ];
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "What's the weather?" },
      { role: "assistant", content: null, tool_calls: toolCalls },
      {
        role: "tool",
        tool_call_id: "call_123",
        content: JSON.stringify({ temp: 22, condition: "Sunny" }),
      },
    ];
    const result = messagesToTranscript(messages);
    expect(result.prompt).toContain("[Tool result for get_weather]:");
    expect(result.prompt).toContain('"temp":22');
    const parsed = JSON.parse(result.transcriptJson);
    // history should include user + assistant + the synthetic tool-result user appended
    // but the synthetic user is sliced off as the last, so entries are: user, assistant(tool_calls), tool
    expect(parsed.transcript.entries.length).toBeGreaterThanOrEqual(2);
  });

  // 14. Multiple tool results as last messages
  it("handles multiple trailing tool messages", () => {
    const toolCalls = [
      {
        id: "call_a",
        type: "function" as const,
        function: { name: "tool_a", arguments: "{}" },
      },
      {
        id: "call_b",
        type: "function" as const,
        function: { name: "tool_b", arguments: "{}" },
      },
    ];
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Do both" },
      { role: "assistant", content: null, tool_calls: toolCalls },
      { role: "tool", tool_call_id: "call_a", content: "result_a" },
      { role: "tool", tool_call_id: "call_b", content: "result_b" },
    ];
    const result = messagesToTranscript(messages);
    expect(result.prompt).toContain("[Tool result for tool_a]: result_a");
    expect(result.prompt).toContain("[Tool result for tool_b]: result_b");
  });

  // 15. Tool as last message with unresolvable tool_call_id
  it("tool as last message with unresolvable id uses fallback format", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Do something" },
      { role: "tool", tool_call_id: "unknown", content: "result" },
    ];
    const result = messagesToTranscript(messages);
    expect(result.prompt).toBe("[Tool result]: result");
  });

  // unknown role is silently ignored
  it("ignores messages with unrecognized roles", () => {
    const messages = [
      { role: "user", content: "Hi" },
      { role: "unknown_role", content: "ignored" },
      { role: "user", content: "Bye" },
    ] as ChatCompletionMessageParam[];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    // Only the first user message should appear as an entry
    expect(parsed.transcript.entries).toHaveLength(1);
    expect(parsed.transcript.entries[0].role).toBe("user");
    expect(result.prompt).toBe("Bye");
  });

  // tool message scans past non-matching assistant tool_calls
  it("tool message scans past assistant with non-matching tool_call ids", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "First" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_other",
            type: "function" as const,
            function: { name: "otherTool", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_missing", content: "result" },
      { role: "user", content: "Next" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const toolEntry = parsed.transcript.entries[2];
    expect(toolEntry.contents[0].text).toBe("[Tool result]: result");
  });

  // extractText with null/undefined content
  it("handles null content in a message", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "First" },
      { role: "assistant", content: null },
      { role: "user", content: "Second" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const assistantEntry = parsed.transcript.entries[1];
    expect(assistantEntry.role).toBe("response");
    expect(assistantEntry.contents[0].text).toBe("");
  });

  // assistant without tool_calls uses extractText
  it("assistant message without tool_calls extracts text content", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Plain response" },
      { role: "user", content: "Ok" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const entry = parsed.transcript.entries[1];
    expect(entry.role).toBe("response");
    expect(entry.contents[0].text).toBe("Plain response");
  });

  // Additional: verify top-level transcript structure
  it("returns correct top-level transcript structure", () => {
    const messages: ChatCompletionMessageParam[] = [{ role: "user", content: "Test" }];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    expect(parsed.type).toBe("FoundationModels.Transcript");
    expect(parsed.version).toBe(1);
    expect(parsed.transcript).toBeDefined();
    expect(Array.isArray(parsed.transcript.entries)).toBe(true);
  });

  // image_url content parts are warned and ignored
  it("warns and ignores image_url content parts", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const messages: ChatCompletionMessageParam[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          { type: "image_url", image_url: { url: "https://example.com/img.png" } },
        ],
      },
    ];
    const result = messagesToTranscript(messages);
    expect(result.prompt).toBe("Describe this image");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("image_url content parts are not supported"),
    );
    warnSpy.mockRestore();
  });

  // Additional: user entries have options: {}
  it("user entries have options field", () => {
    const messages: ChatCompletionMessageParam[] = [
      { role: "user", content: "First" },
      { role: "assistant", content: "Reply" },
      { role: "user", content: "Second" },
    ];
    const result = messagesToTranscript(messages);
    const parsed = JSON.parse(result.transcriptJson);
    const userEntry = parsed.transcript.entries[0];
    expect(userEntry.role).toBe("user");
    expect(userEntry.options).toEqual({});
  });
});
