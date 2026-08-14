import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
const { mockDecodeAndFreeString } = vi.hoisted(() => ({
  mockDecodeAndFreeString: vi.fn((_pointer: unknown): string | null => {
    if (!_pointer) return null;
    return '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[]}}';
  }),
}));

vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
  decodeAndFreeString: mockDecodeAndFreeString,
}));

import { Transcript } from "../../src/transcript.js";
import type { NativePointer } from "../../src/bindings.js";

const mockPointer = (label: string) => label as unknown as NativePointer;

beforeEach(() => {
  vi.clearAllMocks();
  mockDecodeAndFreeString.mockImplementation((pointer: unknown) => {
    if (!pointer) return null;
    return '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[]}}';
  });
});

describe("Transcript", () => {
  describe("toJson", () => {
    it("returns JSON string from C API", () => {
      const transcript = new Transcript(mockPointer("mock-session"));
      const json = transcript.toJson();
      expect(json).toBe(
        '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[]}}',
      );
      expect(mockFns.FMLanguageModelSessionGetTranscriptJSONString).toHaveBeenCalledWith(
        "mock-session",
        null,
        null,
      );
    });

    it("throws when C API returns null", () => {
      mockDecodeAndFreeString.mockReturnValueOnce(null);
      const transcript = new Transcript(mockPointer("mock-session"));
      expect(() => transcript.toJson()).toThrow("Failed to export transcript");
    });
  });

  describe("toDict", () => {
    it("returns parsed JSON object", () => {
      const transcript = new Transcript(mockPointer("mock-session"));
      const dict = transcript.toDict();
      expect(dict).toEqual({
        type: "FoundationModels.Transcript",
        version: 1,
        transcript: { entries: [] },
      });
    });
  });

  describe("fromJson", () => {
    it("creates transcript from JSON string", () => {
      const transcript = Transcript.fromJson('{"type":"transcript"}');
      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalledWith(
        '{"type":"transcript"}',
        expect.any(Array),
        null,
      );
      expect(transcript._nativeSession).toBe("mock-transcript-pointer");
    });

    it("throws when C returns null pointer", () => {
      mockFns.FMTranscriptCreateFromJSONString.mockReturnValueOnce(null);
      expect(() => Transcript.fromJson("bad json")).toThrow();
    });
  });

  describe("fromDict", () => {
    it("serializes dict to JSON and calls fromJson", () => {
      const dict = { type: "transcript", entries: [] };
      const transcript = Transcript.fromDict(dict);
      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalledWith(
        JSON.stringify(dict),
        expect.any(Array),
        null,
      );
      expect(transcript._nativeSession).toBe("mock-transcript-pointer");
    });
  });

  describe("entries", () => {
    it("returns typed entries from a simple transcript", () => {
      const json = JSON.stringify({
        type: "FoundationModels.Transcript",
        version: 1,
        transcript: {
          entries: [
            {
              id: "e1",
              role: "instructions",
              contents: [{ type: "text", text: "You are helpful.", id: "c1" }],
            },
            {
              id: "e2",
              role: "user",
              contents: [{ type: "text", text: "Hello", id: "c2" }],
            },
            {
              id: "e3",
              role: "response",
              contents: [{ type: "text", text: "Hi there!", id: "c3" }],
            },
          ],
        },
      });
      mockDecodeAndFreeString.mockReturnValueOnce(json);
      const transcript = new Transcript(mockPointer("mock-session"));
      const entries = transcript.entries();

      expect(entries).toHaveLength(3);
      expect(entries[0].role).toBe("instructions");
      expect(entries[1].role).toBe("user");
      expect(entries[2].role).toBe("response");
      expect(entries[0].contents?.[0]).toEqual({
        type: "text",
        text: "You are helpful.",
        id: "c1",
      });
    });

    it("returns entries with tool calls and tool output", () => {
      const json = JSON.stringify({
        type: "FoundationModels.Transcript",
        version: 1,
        transcript: {
          entries: [
            {
              id: "e1",
              role: "response",
              toolCalls: [{ id: "tc1", name: "get_weather", arguments: '{"city":"SF"}' }],
            },
            {
              id: "e2",
              role: "tool",
              contents: [{ type: "text", text: '{"temp":72}', id: "c1" }],
              toolName: "get_weather",
              toolCallID: "tc1",
            },
          ],
        },
      });
      mockDecodeAndFreeString.mockReturnValueOnce(json);
      const transcript = new Transcript(mockPointer("mock-session"));
      const entries = transcript.entries();

      expect(entries).toHaveLength(2);
      expect(entries[0].toolCalls?.[0]).toEqual({
        id: "tc1",
        name: "get_weather",
        arguments: '{"city":"SF"}',
      });
      expect(entries[1].role).toBe("tool");
      expect(entries[1].toolName).toBe("get_weather");
      expect(entries[1].toolCallID).toBe("tc1");
    });

    it("returns entries with structured content", () => {
      const json = JSON.stringify({
        type: "FoundationModels.Transcript",
        version: 1,
        transcript: {
          entries: [
            {
              id: "e1",
              role: "response",
              contents: [
                {
                  type: "structure",
                  id: "s1",
                  structure: { source: '{"name":"Ada"}', content: { name: "Ada" } },
                },
              ],
            },
          ],
        },
      });
      mockDecodeAndFreeString.mockReturnValueOnce(json);
      const transcript = new Transcript(mockPointer("mock-session"));
      const entries = transcript.entries();

      expect(entries).toHaveLength(1);
      const content = entries[0].contents?.[0];
      expect(content?.type).toBe("structure");
      if (content?.type === "structure") {
        expect(content.structure.content).toEqual({ name: "Ada" });
      }
    });

    it("returns empty array for transcript with no entries", () => {
      const transcript = new Transcript(mockPointer("mock-session"));
      const entries = transcript.entries();
      expect(entries).toEqual([]);
    });

    it("returns empty array when entries key is missing from JSON", () => {
      mockDecodeAndFreeString.mockReturnValueOnce(
        '{"type":"FoundationModels.Transcript","version":1,"transcript":{}}',
      );
      const transcript = new Transcript(mockPointer("mock-session"));
      const entries = transcript.entries();
      expect(entries).toEqual([]);
    });
  });

  describe("_updateNativeSession", () => {
    it("updates the internal session pointer", () => {
      const transcript = new Transcript(mockPointer("old-session"));
      transcript._updateNativeSession(mockPointer("new-session"));
      expect(transcript._nativeSession).toBe("new-session");
    });

    it("releases an owned pointer it is about to overwrite", () => {
      // fromTranscript() repoints a standalone transcript at the new session.
      // Without this the deserialized C object is orphaned with no way to free it.
      const transcript = Transcript.fromJson("{}");
      transcript._updateNativeSession(mockPointer("new-session"));
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-transcript-pointer");
    });

    it("does not release the session pointer it was handed", () => {
      const transcript = Transcript.fromJson("{}");
      transcript._updateNativeSession(mockPointer("new-session"));
      mockFns.FMRelease.mockClear();
      transcript.dispose();
      expect(mockFns.FMRelease).not.toHaveBeenCalled();
    });
  });

  describe("dispose", () => {
    it("releases the C object owned by fromJson", () => {
      const transcript = Transcript.fromJson("{}");
      transcript.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-transcript-pointer");
    });

    it("releases the C object owned by fromDict", () => {
      const transcript = Transcript.fromDict({});
      transcript.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-transcript-pointer");
    });

    it("is safe to call more than once", () => {
      const transcript = Transcript.fromJson("{}");
      transcript.dispose();
      transcript.dispose();
      expect(mockFns.FMRelease).toHaveBeenCalledTimes(1);
    });

    it("does not release a pointer owned by a live session", () => {
      // LanguageModelSession.dispose() frees this pointer; releasing it here
      // as well would be a double free.
      const transcript = new Transcript(mockPointer("mock-session"));
      transcript.dispose();
      expect(mockFns.FMRelease).not.toHaveBeenCalled();
    });

    it("is invoked by Symbol.dispose", () => {
      const transcript = Transcript.fromJson("{}");
      transcript[Symbol.dispose]();
      expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-transcript-pointer");
    });

    it("makes subsequent toJson() throw rather than read freed memory", () => {
      const transcript = Transcript.fromJson("{}");
      transcript.dispose();
      expect(() => transcript.toJson()).toThrow(/disposed/i);
    });
  });
});
