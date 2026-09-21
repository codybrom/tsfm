import { vi, describe, it, expect, beforeEach } from "vitest";
import { coreBindingsMock, errorsMock, mockPointer } from "./_helpers.js";

vi.mock("../../../src/bindings.js", () => coreBindingsMock());
vi.mock("../../../src/errors.js", () => errorsMock());

import { GeneratedContent, type JsonObject } from "tsfm-sdk";
import {
  FetchEmailsTool,
  SaveDraftTool,
  triageSchema,
  formatTriage,
  type Email,
  type TriageResult,
} from "../../../examples/email-triage/email-triage.js";

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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// triageSchema
// ---------------------------------------------------------------------------

describe("triageSchema", () => {
  const results = triageSchema.properties.results;

  it("is a valid JSON Schema with required results array", () => {
    expect(triageSchema.type).toBe("object");
    expect(triageSchema.required).toContain("results");
    expect(results.type).toBe("array");
  });

  it("defines priority as integer with range 1-5", () => {
    const itemProps = results.items.properties;
    expect(itemProps.priority.type).toBe("integer");
    expect(itemProps.priority.minimum).toBe(1);
    expect(itemProps.priority.maximum).toBe(5);
  });

  it("defines category as enum", () => {
    const itemProps = results.items.properties;
    expect(itemProps.category.enum).toContain("action-required");
    expect(itemProps.category.enum).toContain("fyi");
    expect(itemProps.category.enum).toContain("scheduling");
  });

  it("defines suggested_action as enum", () => {
    const itemProps = results.items.properties;
    expect(itemProps.suggested_action.enum).toContain("reply-now");
    expect(itemProps.suggested_action.enum).toContain("archive");
    expect(itemProps.suggested_action.enum).toContain("unsubscribe");
  });
});

// ---------------------------------------------------------------------------
// FetchEmailsTool
// ---------------------------------------------------------------------------

describe("FetchEmailsTool", () => {
  const sampleEmails: Email[] = [
    {
      id: "msg-001",
      from: "Alice <alice@example.com>",
      subject: "Quick question",
      date: "2026-03-30T09:00:00Z",
      body: "Hey, can we chat?",
    },
    {
      id: "msg-002",
      from: "Bob <bob@example.com>",
      subject: "FYI: deploy complete",
      date: "2026-03-30T10:00:00Z",
      body: "Deploy went smoothly.",
    },
  ];

  it("returns all emails as JSON", async () => {
    const tool = new FetchEmailsTool(sampleEmails);
    const result = await tool.call(mockContent({}));
    const parsed = JSON.parse(result);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("msg-001");
    expect(parsed[1].subject).toBe("FYI: deploy complete");
    tool.dispose();
  });

  it("has correct tool metadata", () => {
    const tool = new FetchEmailsTool([]);
    expect(tool.name).toBe("fetch_emails");
    expect(tool.description).toContain("Fetch unread emails");
    tool.dispose();
  });
});

// ---------------------------------------------------------------------------
// SaveDraftTool
// ---------------------------------------------------------------------------

describe("SaveDraftTool", () => {
  it("saves draft and confirms", async () => {
    const tool = new SaveDraftTool();
    const args = mockContent({
      email_id: "msg-001",
      draft: "Thanks, will do!",
    });

    const result = await tool.call(args);
    expect(result).toContain("msg-001");
    expect(tool.savedDrafts).toHaveLength(1);
    expect(tool.savedDrafts[0].emailId).toBe("msg-001");
    expect(tool.savedDrafts[0].draft).toBe("Thanks, will do!");

    tool.dispose();
  });

  it("accumulates multiple drafts", async () => {
    const tool = new SaveDraftTool();

    await tool.call(mockContent({ email_id: "msg-001", draft: "Draft 1" }));
    await tool.call(mockContent({ email_id: "msg-002", draft: "Draft 2" }));

    expect(tool.savedDrafts).toHaveLength(2);

    tool.dispose();
  });

  it("has correct tool metadata", () => {
    const tool = new SaveDraftTool();
    expect(tool.name).toBe("save_draft");
    expect(tool.description).toContain("Save a finalized reply draft");
    tool.dispose();
  });
});

// ---------------------------------------------------------------------------
// formatTriage
// ---------------------------------------------------------------------------

describe("formatTriage", () => {
  const sampleResults: TriageResult[] = [
    {
      email_id: "msg-005",
      sender: "Elena Vasquez",
      subject: "Q2 planning: need your capacity estimate",
      summary: "Capacity estimate due Wednesday.",
      priority: 2,
      category: "action-required",
      suggested_action: "reply-now",
    },
    {
      email_id: "msg-004",
      sender: "Notion",
      subject: "Your weekly workspace digest",
      summary: "Workspace activity summary.",
      priority: 5,
      category: "promotional",
      suggested_action: "archive",
    },
    {
      email_id: "msg-003",
      sender: "Jordan Mills",
      subject: "Coffee next week?",
      summary: "Wants to meet for coffee Tue-Thu.",
      priority: 3,
      category: "scheduling",
      suggested_action: "reply-later",
    },
  ];

  it("sorts by priority (highest first)", () => {
    const out = formatTriage(sampleResults);
    const lines = out.split("\n");
    const firstResult = lines[0];
    const lastSubject = lines.findIndex((l) => l.includes("workspace digest"));
    expect(firstResult).toContain("HIGH");
    expect(lastSubject).toBeGreaterThan(0);
  });

  it("shows priority labels with icons", () => {
    const out = formatTriage(sampleResults);
    expect(out).toContain("🟠 HIGH");
    expect(out).toContain("🟡 MEDIUM");
    expect(out).toContain("⚪ SKIP");
  });

  it("shows action labels with icons", () => {
    const out = formatTriage(sampleResults);
    expect(out).toContain("↩️  Reply now");
    expect(out).toContain("⏰ Reply later");
    expect(out).toContain("📦 Archive");
  });

  it("includes sender and category", () => {
    const out = formatTriage(sampleResults);
    expect(out).toContain("Elena Vasquez");
    expect(out).toContain("action-required");
    expect(out).toContain("promotional");
  });

  it("includes summaries", () => {
    const out = formatTriage(sampleResults);
    expect(out).toContain("Capacity estimate due Wednesday.");
    expect(out).toContain("Wants to meet for coffee");
  });

  it("handles empty results", () => {
    const out = formatTriage([]);
    expect(out).toBe("");
  });

  it("does not mutate the input array", () => {
    const input: TriageResult[] = [
      { ...sampleResults[2] }, // priority 3
      { ...sampleResults[0] }, // priority 2
    ];
    const originalFirst = input[0].priority;
    formatTriage(input);
    expect(input[0].priority).toBe(originalFirst);
  });
});
