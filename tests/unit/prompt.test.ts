import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMockFunctions } from "./helpers/mock-bindings.js";
import { composePrompt } from "../../src/prompt.js";
import { PromptAttachmentError } from "../../src/errors.js";

const mockFns = createMockFunctions();
const fn = mockFns as unknown as Parameters<typeof composePrompt>[0];

// Attachments must exist on disk, so the tests use real files.
let dir: string;
let image: string;
let other: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tsfm-prompt-"));
  image = path.join(dir, "a.png");
  other = path.join(dir, "b.png");
  writeFileSync(image, "png");
  writeFileSync(other, "png");
  mkdirSync(path.join(dir, "folder.png"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** The native calls that added parts, in order. */
function addedParts(): Array<string | [string, string | null]> {
  const calls: Array<{ order: number; part: string | [string, string | null] }> = [];
  mockFns.FMComposedPromptAddText.mock.calls.forEach((c, i) => {
    calls.push({
      order: mockFns.FMComposedPromptAddText.mock.invocationCallOrder[i],
      part: c[1],
    });
  });
  mockFns.FMComposedPromptAddAttachment.mock.calls.forEach((c, i) => {
    calls.push({
      order: mockFns.FMComposedPromptAddAttachment.mock.invocationCallOrder[i],
      part: [c[1], c[2]],
    });
  });
  return calls.sort((a, b) => a.order - b.order).map((c) => c.part);
}

describe("composePrompt", () => {
  it("adds a plain string as one text part", () => {
    composePrompt(fn, "Hello");
    expect(addedParts()).toEqual(["Hello"]);
  });

  it("adds text then attachments for the { text, attachments } shape", () => {
    composePrompt(fn, { text: "What is this?", attachments: [{ path: image, label: "chart" }] });
    expect(addedParts()).toEqual(["What is this?", [image, "chart"]]);
  });

  it("keeps the text of a { text } prompt even when it's empty", () => {
    composePrompt(fn, { text: "" });
    expect(addedParts()).toEqual([""]);
  });

  describe("the { content } shape", () => {
    it("composes parts in array order, text after images included", () => {
      composePrompt(fn, {
        content: [{ path: image, label: "before" }, { path: other }, "What changed?", "Be brief."],
      });
      expect(addedParts()).toEqual([
        [image, "before"],
        [other, null],
        "What changed?",
        "Be brief.",
      ]);
    });

    it("sends only text when there are no attachments", () => {
      composePrompt(fn, { content: ["Only text"] });
      expect(addedParts()).toEqual(["Only text"]);
    });

    it("sends no text component for an attachment-only prompt", () => {
      composePrompt(fn, { content: [{ path: image }] });
      expect(addedParts()).toEqual([[image, null]]);
      expect(mockFns.FMComposedPromptAddText).not.toHaveBeenCalled();
    });

    it("composes an empty prompt from an empty array", () => {
      const composed = composePrompt(fn, { content: [] });
      expect(composed).toBe("mock-composed-prompt");
      expect(addedParts()).toEqual([]);
    });
  });

  describe("attachment existence", () => {
    it("throws not-found before any native call for a missing file", () => {
      const missing = path.join(dir, "missing.png");
      let err: unknown;
      try {
        composePrompt(fn, { text: "hi", attachments: [{ path: missing }] });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(PromptAttachmentError);
      expect((err as PromptAttachmentError).reason).toBe("not-found");
      expect((err as Error).message).toContain(missing);
      expect(mockFns.FMComposedPromptInitialize).not.toHaveBeenCalled();
    });

    it("treats a directory as not found", () => {
      expect(() =>
        composePrompt(fn, { content: [{ path: path.join(dir, "folder.png") }] }),
      ).toThrow(/isn't a file/);
      expect(mockFns.FMComposedPromptInitialize).not.toHaveBeenCalled();
    });

    it("checks every attachment before composing, so a later bad path costs nothing", () => {
      expect(() =>
        composePrompt(fn, { content: [{ path: image }, "and", { path: "/nope/x.png" }] }),
      ).toThrow(/doesn't exist/);
      expect(mockFns.FMComposedPromptInitialize).not.toHaveBeenCalled();
    });
  });

  it("releases the composed prompt when the bridge refuses an attachment", () => {
    mockFns.FMComposedPromptAddAttachment.mockReturnValueOnce(1);
    let err: unknown;
    try {
      composePrompt(fn, { content: [{ path: image }] });
    } catch (e) {
      err = e;
    }
    expect((err as PromptAttachmentError).reason).toBe("unsupported-os");
    expect(mockFns.FMRelease).toHaveBeenCalledWith("mock-composed-prompt");
  });

  it.each([
    [{ attachments: [{ path: "/tmp/x.png" }] }, 'has no "text"'],
    [{ text: 42 }, 'has no "text"'],
    [{ content: "not an array" }, '"content" must be an array'],
    [{ text: "hi", attachments: "no" }, '"attachments" must be an array'],
    [{ content: [null] }, "must be text or an attachment"],
    [{ content: [{ label: "no path" }] }, "must be text or an attachment"],
    [null, "A prompt must be"],
    [7, "A prompt must be"],
  ])("refuses the prompt shape %j with a TypeError", (prompt, message) => {
    expect(() => composePrompt(fn, prompt as never)).toThrow(TypeError);
    expect(() => composePrompt(fn, prompt as never)).toThrow(message as string);
    expect(mockFns.FMComposedPromptInitialize).not.toHaveBeenCalled();
  });

  it("reads the shape from the prompt's own properties, not the prototype", () => {
    const polluted = Object.create({ content: [{ path: "/nope.png" }] }) as { text: string };
    polluted.text = "Hello";
    composePrompt(fn, polluted);
    expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith("mock-composed-prompt", "Hello");
    expect(mockFns.FMComposedPromptAddAttachment).not.toHaveBeenCalled();
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])("treats attachments: %s like a text-only prompt", (_name, value) => {
    composePrompt(fn, { text: "Hello", attachments: value } as never);
    expect(mockFns.FMComposedPromptAddText).toHaveBeenCalledWith("mock-composed-prompt", "Hello");
    expect(mockFns.FMComposedPromptAddAttachment).not.toHaveBeenCalled();
  });
});
