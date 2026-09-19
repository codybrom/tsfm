import { vi, describe, it, expect, beforeEach } from "vitest";
import { coreBindingsMock, errorsMock, mockPointer } from "./_helpers.js";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../src/bindings.js", () => coreBindingsMock());
vi.mock("../../../src/errors.js", () => errorsMock());

import { GeneratedContent, type JsonObject } from "tsfm-sdk";
import {
  JournalStore,
  JournalAnalysis,
  SaveEntryTool,
  QueryEntryTool,
  formatAnalysis,
  type JournalEntry,
  type JournalAnalysisData,
} from "../../../examples/journal/journal.js";

function mockContent(values: JsonObject): GeneratedContent {
  const json = JSON.stringify(values);
  const content = new GeneratedContent(mockPointer());
  vi.spyOn(content, "toJson").mockReturnValue(json);
  vi.spyOn(content, "toObject").mockReturnValue(values);
  const valueMap = new Map(Object.entries(values));
  vi.spyOn(content, "value").mockImplementation(<T>(key: string): T => {
    if (!valueMap.has(key)) throw new Error(`Property '${key}' not found`);
    return valueMap.get(key) as T;
  });
  return content;
}

function tmpStore(): { store: JournalStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "tsfm-journal-test-"));
  const path = join(dir, "entries.json");
  return { store: new JournalStore(path), path };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// JournalStore
// ---------------------------------------------------------------------------

describe("JournalStore", () => {
  it("starts empty", () => {
    const { store } = tmpStore();
    expect(store.size).toBe(0);
    expect(store.query()).toEqual([]);
  });

  it("adds and persists entries", () => {
    const { store, path } = tmpStore();
    const entry: JournalEntry = {
      date: "2026-03-28",
      mood: "calm",
      intensity: 5,
      themes: ["nature"],
      summary: "Peaceful day.",
      raw: "Went for a walk.",
    };
    store.add(entry);
    expect(store.size).toBe(1);

    // Verify persisted to disk
    const ondisk = JSON.parse(readFileSync(path, "utf-8"));
    expect(ondisk).toHaveLength(1);
    expect(ondisk[0].mood).toBe("calm");
  });

  it("loads existing entries from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "tsfm-journal-test-"));
    const path = join(dir, "entries.json");
    writeFileSync(
      path,
      JSON.stringify([
        {
          date: "2026-03-27",
          mood: "joyful",
          intensity: 8,
          themes: ["fun"],
          summary: "Great day.",
          raw: "!",
        },
      ]),
    );
    const store = new JournalStore(path);
    expect(store.size).toBe(1);
    expect(store.query()[0].mood).toBe("joyful");
  });

  it("filters by after_date", () => {
    const { store } = tmpStore();
    store.add({
      date: "2026-03-25",
      mood: "anxious",
      intensity: 7,
      themes: ["work"],
      summary: "Busy.",
      raw: "...",
    });
    store.add({
      date: "2026-03-27",
      mood: "calm",
      intensity: 4,
      themes: ["rest"],
      summary: "Relaxed.",
      raw: "...",
    });
    store.add({
      date: "2026-03-29",
      mood: "energized",
      intensity: 8,
      themes: ["gym"],
      summary: "Strong.",
      raw: "...",
    });

    const recent = store.query("2026-03-27");
    expect(recent).toHaveLength(2);
    expect(recent[0].date).toBe("2026-03-27");
    expect(recent[1].date).toBe("2026-03-29");
  });
});

// ---------------------------------------------------------------------------
// JournalAnalysis schema
// ---------------------------------------------------------------------------

describe("JournalAnalysis", () => {
  it("has a schema with a native pointer", () => {
    expect(JournalAnalysis.schema._nativeSchema).toBe("mock-schema-pointer");
  });

  it("parses structured content", () => {
    const data = {
      mood: "grateful",
      intensity: 7,
      themes: ["family", "cooking"],
      summary: "Lovely dinner with the family.",
    };
    const content = mockContent(data);
    const parsed = JournalAnalysis.parse(content);
    expect(parsed.mood).toBe("grateful");
    expect(parsed.intensity).toBe(7);
    expect(parsed.themes).toEqual(["family", "cooking"]);
  });
});

// ---------------------------------------------------------------------------
// SaveEntryTool
// ---------------------------------------------------------------------------

describe("SaveEntryTool", () => {
  it("persists entry to store", async () => {
    const { store } = tmpStore();
    const tool = new SaveEntryTool(store, "Raw journal text", ["work", "progress"]);

    const args = mockContent({
      date: "2026-03-30",
      mood: "energized",
      intensity: 8,
      summary: "Productive day.",
    });

    const result = await tool.call(args);
    expect(result).toContain("2026-03-30");
    expect(result).toContain("energized");
    expect(store.size).toBe(1);

    const saved = store.query()[0];
    expect(saved.raw).toBe("Raw journal text");
    expect(saved.themes).toEqual(["work", "progress"]);
    expect(saved.mood).toBe("energized");

    tool.dispose();
  });

  it("has correct tool metadata", () => {
    const { store } = tmpStore();
    const tool = new SaveEntryTool(store, "", []);
    expect(tool.name).toBe("save_entry");
    expect(tool.description).toContain("Save a journal entry");
    tool.dispose();
  });
});

// ---------------------------------------------------------------------------
// QueryEntryTool
// ---------------------------------------------------------------------------

describe("QueryEntryTool", () => {
  it("returns formatted entries", async () => {
    const { store } = tmpStore();
    store.add({
      date: "2026-03-28",
      mood: "calm",
      intensity: 5,
      themes: ["nature", "reading"],
      summary: "Quiet afternoon.",
      raw: "...",
    });

    const tool = new QueryEntryTool(store);
    const args = mockContent({});
    vi.spyOn(args, "value").mockImplementation(() => {
      throw new Error("not found");
    });

    const result = await tool.call(args);
    expect(result).toContain("2026-03-28");
    expect(result).toContain("calm");
    expect(result).toContain("nature, reading");
    expect(result).toContain("Quiet afternoon.");

    tool.dispose();
  });

  it("returns 'no entries' for empty store", async () => {
    const { store } = tmpStore();
    const tool = new QueryEntryTool(store);
    const args = mockContent({});
    vi.spyOn(args, "value").mockImplementation(() => {
      throw new Error("not found");
    });

    const result = await tool.call(args);
    expect(result).toBe("No journal entries found.");

    tool.dispose();
  });

  it("filters by after_date when provided", async () => {
    const { store } = tmpStore();
    store.add({
      date: "2026-03-25",
      mood: "anxious",
      intensity: 7,
      themes: ["work"],
      summary: "Busy.",
      raw: "...",
    });
    store.add({
      date: "2026-03-29",
      mood: "calm",
      intensity: 4,
      themes: ["rest"],
      summary: "Easy.",
      raw: "...",
    });

    const tool = new QueryEntryTool(store);
    const args = mockContent({ after_date: "2026-03-28" });

    const result = await tool.call(args);
    expect(result).toContain("2026-03-29");
    expect(result).not.toContain("2026-03-25");

    tool.dispose();
  });
});

// ---------------------------------------------------------------------------
// formatAnalysis
// ---------------------------------------------------------------------------

describe("formatAnalysis", () => {
  it("shows mood icon and intensity bar", () => {
    const analysis: JournalAnalysisData = {
      mood: "joyful",
      intensity: 8,
      themes: ["friends", "music"],
      summary: "Great evening out.",
    };
    const out = formatAnalysis(analysis);
    expect(out).toContain("😊");
    expect(out).toContain("joyful");
    expect(out).toContain("████████░░");
    expect(out).toContain("8/10");
  });

  it("lists themes", () => {
    const analysis: JournalAnalysisData = {
      mood: "anxious",
      intensity: 6,
      themes: ["deadline", "meetings"],
      summary: "Stressful day.",
    };
    const out = formatAnalysis(analysis);
    expect(out).toContain("deadline, meetings");
  });

  it("falls back to default icon for unknown mood", () => {
    const analysis: JournalAnalysisData = {
      mood: "bewildered",
      intensity: 3,
      themes: ["confusion"],
      summary: "Odd day.",
    };
    const out = formatAnalysis(analysis);
    expect(out).toContain("📝");
  });
});
