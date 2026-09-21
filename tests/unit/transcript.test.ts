import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockFunctions, failed, ok } from "./helpers/mock-bindings.js";

const mockFns = createMockFunctions();
vi.mock("../../src/bindings.js", () => ({
  getFunctions: () => mockFns,
}));

const EMPTY = '{"type":"FoundationModels.Transcript","version":1,"transcript":{"entries":[]}}';
/** The transcript JSON the native side exports; tests queue readings on it. */
const transcriptJson = vi.fn((): string | null => EMPTY);

import { Transcript } from "../../src/transcript.js";
import { FoundationModelsError } from "../../src/errors.js";
import type { NativePointer } from "../../src/bindings.js";

const mockPointer = (label: string) => label as unknown as NativePointer;

beforeEach(() => {
  vi.clearAllMocks();
  transcriptJson.mockImplementation(() => EMPTY);
  mockFns.FMLanguageModelSessionGetTranscriptJSONString.mockImplementation(() =>
    ok(transcriptJson()),
  );
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
      );
    });

    it("throws the typed error for the native status when export fails", () => {
      mockFns.FMLanguageModelSessionGetTranscriptJSONString.mockReturnValueOnce(
        failed(6, "bad transcript"),
      );
      const transcript = new Transcript(mockPointer("mock-session"));
      expect(() => transcript.toJson()).toThrow(/Decoding failure.*bad transcript/);
    });

    it("throws when C API returns null", () => {
      transcriptJson.mockReturnValueOnce(null);
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
      );
      expect(transcript._nativeSession).toBe("mock-transcript-pointer");
    });

    it("throws when C returns null pointer", () => {
      mockFns.FMTranscriptCreateFromJSONString.mockReturnValueOnce(failed(6));
      expect(() => Transcript.fromJson("bad json")).toThrow();
    });
  });

  describe("fromDict", () => {
    it("serializes dict to JSON and calls fromJson", () => {
      const dict = { type: "transcript", entries: [] };
      const transcript = Transcript.fromDict(dict);
      expect(mockFns.FMTranscriptCreateFromJSONString).toHaveBeenCalledWith(JSON.stringify(dict));
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
      transcriptJson.mockReturnValueOnce(json);
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

    it("returns Private Cloud Compute reasoning entries", () => {
      // The shape a PCC request with reasoningLevel "deep" produces on macOS 27.
      const json = JSON.stringify({
        version: 1,
        type: "FoundationModels.Transcript",
        transcript: {
          entries: [
            {
              id: "u1",
              role: "user",
              contents: [{ type: "text", text: "Is 1001 prime?", id: "c1" }],
              options: {},
              contextOptions: { reasoningLevel: "deep" },
            },
            { id: "r1", role: "reasoning", reasoning: { contents: [], signature: "opaque" } },
            {
              id: "r1",
              role: "response",
              contents: [{ type: "text", text: "No.", id: "c2" }],
              metadata: { systemVersion: "x" },
            },
          ],
        },
      });
      transcriptJson.mockReturnValueOnce(json);
      const entries = new Transcript(mockPointer("mock-session")).entries();

      expect(entries.map((e) => e.role)).toEqual(["user", "reasoning", "response"]);
      expect(entries[0].contextOptions).toEqual({ reasoningLevel: "deep" });
      expect(entries[1].reasoning).toEqual({ contents: [], signature: "opaque" });
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
      transcriptJson.mockReturnValueOnce(json);
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
      transcriptJson.mockReturnValueOnce(json);
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
      transcriptJson.mockReturnValueOnce(
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

  describe("_pointer", () => {
    it("returns the native pointer of a usable transcript", () => {
      expect(Transcript.fromJson("{}")._pointer()).toBe("mock-transcript-pointer");
    });

    it("throws FoundationModelsError once disposed", () => {
      const transcript = Transcript.fromJson("{}");
      transcript.dispose();
      expect(() => transcript._pointer()).toThrow(FoundationModelsError);
      expect(() => transcript._pointer()).toThrow(/disposed/);
    });

    it("throws FoundationModelsError once its session is disposed", () => {
      const transcript = new Transcript(mockPointer("mock-session"));
      transcript._detach();
      expect(() => transcript._pointer()).toThrow(FoundationModelsError);
      expect(() => transcript._pointer()).toThrow(/session .* disposed/);
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
