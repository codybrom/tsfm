import { vi, describe, it, expect, beforeEach } from "vitest";
import { koffiMock, coreBindingsMock, errorsMock, mockPointer } from "./_helpers.js";

vi.mock("koffi", () => koffiMock());
vi.mock("../../../src/bindings.js", () => coreBindingsMock());
vi.mock("../../../src/errors.js", () => errorsMock());

import { GeneratedContent, type JsonObject } from "tsfm-sdk";
import {
  ContactCard,
  formatContactCard,
  sampleContacts,
  type ContactCardData,
} from "../../../examples/contact-card/contact-card.js";

function mockContent(obj: JsonObject): GeneratedContent {
  const json = JSON.stringify(obj);
  const content = new GeneratedContent(mockPointer());
  vi.spyOn(content, "toJson").mockReturnValue(json);
  vi.spyOn(content, "toObject").mockReturnValue(obj);
  return content;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("ContactCard schema", () => {
  it("has a schema with a native pointer", () => {
    expect(ContactCard.schema).toBeDefined();
    expect(ContactCard.schema._nativeSchema).toBe("mock-schema-pointer");
  });

  it("parse extracts typed data", () => {
    const data = {
      name: "Alice",
      company: "Acme",
      title: "CEO",
      emails: [{ address: "alice@acme.com", label: "work" }],
      phones: [{ number: "555-0100", label: "mobile" }],
      location: "New York, NY",
      website: "https://acme.com",
      context: "Met at WWDC",
      confidence: 95,
    };
    const content = mockContent(data);
    const parsed = ContactCard.parse(content);

    expect(parsed.name).toBe("Alice");
    expect(parsed.company).toBe("Acme");
    expect(parsed.emails).toHaveLength(1);
    expect(parsed.emails[0].label).toBe("work");
    expect(parsed.phones[0].label).toBe("mobile");
    expect(parsed.confidence).toBe(95);
  });

  it("parse handles missing optional fields", () => {
    const data = {
      name: "Bob",
      emails: [],
      phones: [],
      confidence: 40,
    };
    const content = mockContent(data);
    const parsed = ContactCard.parse(content);

    expect(parsed.name).toBe("Bob");
    expect(parsed.company).toBeUndefined();
    expect(parsed.title).toBeUndefined();
    expect(parsed.location).toBeUndefined();
    expect(parsed.website).toBeUndefined();
    expect(parsed.context).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

describe("sampleContacts", () => {
  it("provides 3 realistic samples", () => {
    expect(sampleContacts).toHaveLength(3);
    for (const s of sampleContacts) {
      expect(s.label).toBeTruthy();
      expect(s.text).toBeTruthy();
      expect(s.text.length).toBeGreaterThan(20);
    }
  });

  it("covers different source types", () => {
    const labels = sampleContacts.map((s) => s.label);
    expect(labels).toContain("Email signature");
    expect(labels).toContain("Conference badge notes");
    expect(labels).toContain("Business card OCR");
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatContactCard", () => {
  const fullCard: ContactCardData = {
    name: "Sarah Chen",
    title: "VP Engineering",
    company: "Meridian Systems",
    emails: [{ address: "sarah@meridian.io", label: "work" }],
    phones: [
      { number: "(415) 555-0142", label: "work" },
      { number: "415-555-0199", label: "mobile" },
    ],
    location: "San Francisco, CA",
    website: "https://meridian.io",
    context: "Met at AWS re:Invent 2025",
    confidence: 92,
  };

  it("includes name, title, and company in header", () => {
    const out = formatContactCard(fullCard);
    expect(out).toContain("Sarah Chen — VP Engineering @ Meridian Systems");
  });

  it("lists all emails with labels", () => {
    const out = formatContactCard(fullCard);
    expect(out).toContain("work");
    expect(out).toContain("sarah@meridian.io");
  });

  it("lists all phone numbers", () => {
    const out = formatContactCard(fullCard);
    expect(out).toContain("(415) 555-0142");
    expect(out).toContain("415-555-0199");
    expect(out).toContain("mobile");
  });

  it("shows location, website, context", () => {
    const out = formatContactCard(fullCard);
    expect(out).toContain("San Francisco, CA");
    expect(out).toContain("https://meridian.io");
    expect(out).toContain("Met at AWS re:Invent 2025");
  });

  it("shows confidence percentage", () => {
    const out = formatContactCard(fullCard);
    expect(out).toContain("confidence 92%");
  });

  it("handles minimal card (no optional fields)", () => {
    const minimal: ContactCardData = {
      name: "Unknown Person",
      emails: [],
      phones: [],
      confidence: 20,
    };
    const out = formatContactCard(minimal);
    expect(out).toContain("Unknown Person");
    expect(out).toContain("confidence 20%");
    expect(out).not.toContain("undefined");
  });

  it("omits missing optional fields without 'undefined' in output", () => {
    const partial: ContactCardData = {
      name: "Partial",
      company: "SomeCo",
      emails: [{ address: "p@some.co", label: "work" }],
      phones: [],
      confidence: 60,
    };
    const out = formatContactCard(partial);
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("location");
    expect(out).not.toContain("web ");
    expect(out).not.toContain("context");
  });
});
