/**
 * Contact Card Parser
 *
 * Paste messy contact info (email signatures, conference badge scrawl,
 * business card OCR) and get clean, structured contact cards.
 *
 * Demonstrates:
 * - generable() with deeply nested schemas (arrays of typed objects)
 * - GenerationGuide constraints at depth (anyOf, regex, range)
 * - prewarm() for latency optimization
 * - Batch structured extraction across a multi-turn session
 * - respond() chained after respondWithSchema() for natural summaries
 */

import {
  LanguageModelSession,
  SystemLanguageModel,
  generable,
  GenerationGuide,
  type InferSchema,
  type PropertyDef,
} from "tsfm-sdk";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const contactProperties = {
  name: { type: "string", description: "Full name" },
  company: {
    type: "string",
    optional: true,
    description: "Company or organization",
  },
  title: { type: "string", optional: true, description: "Job title or role" },
  emails: {
    type: "array",
    items: {
      type: "object",
      properties: {
        address: { type: "string", description: "Email address" },
        label: {
          type: "string",
          description: "Type of email",
          guides: [GenerationGuide.anyOf(["work", "personal", "other"])],
        },
      },
    },
    description: "Email addresses found in the text",
  },
  phones: {
    type: "array",
    items: {
      type: "object",
      properties: {
        number: {
          type: "string",
          description: "Phone number in original format",
        },
        label: {
          type: "string",
          description: "Type of phone number",
          guides: [GenerationGuide.anyOf(["mobile", "work", "home", "fax", "other"])],
        },
      },
    },
    description: "Phone numbers found in the text",
  },
  location: {
    type: "string",
    optional: true,
    description: "City, state, or address",
  },
  website: { type: "string", optional: true, description: "Website or URL" },
  context: {
    type: "string",
    optional: true,
    description: "How you know this person or where you met them",
  },
  confidence: {
    type: "integer",
    description: "How confident the extraction is, from 0 to 100",
    guides: [GenerationGuide.range(0, 100)],
  },
} satisfies Record<string, PropertyDef>;

export const ContactCard = generable("ContactCard", contactProperties);
export type ContactCardData = InferSchema<typeof contactProperties>;

// ---------------------------------------------------------------------------
// Sample data — realistic messy inputs
// ---------------------------------------------------------------------------

export const sampleContacts = [
  {
    label: "Email signature",
    text: `Best,
Sarah Chen | VP Engineering
Meridian Systems Inc.
sarah.chen@meridian.io | (415) 555-0142
120 Howard St, San Francisco CA`,
  },
  {
    label: "Conference badge notes",
    text: `Marcus Rivera - Stripe
talked about webhooks + idempotency
marcus@stripe.com
cell 650-555-0198
linkedin: /in/marcusrivera`,
  },
  {
    label: "Business card OCR",
    text: `ANIKA PATEL
Chief Data Officer
Luminary Health
anika.patel@luminaryhealth.com
w: 212-555-0167 m: 917-555-0234
www.luminaryhealth.com
350 5th Ave, New York, NY 10118`,
  },
];

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatContactCard(card: ContactCardData): string {
  const lines: string[] = [];

  // Name + title + company
  let header = card.name;
  if (card.title) header += ` — ${card.title}`;
  if (card.company) header += ` @ ${card.company}`;
  lines.push(header);
  lines.push("─".repeat(Math.min(header.length, 60)));

  for (const email of card.emails ?? []) {
    lines.push(`  ${email.label.padEnd(10)} ${email.address}`);
  }
  for (const phone of card.phones ?? []) {
    lines.push(`  ${phone.label.padEnd(10)} ${phone.number}`);
  }
  if (card.location) lines.push(`  location  ${card.location}`);
  if (card.website) lines.push(`  web       ${card.website}`);
  if (card.context) lines.push(`  context   ${card.context}`);
  lines.push(`  confidence ${card.confidence}%`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const model = new SystemLanguageModel();
  const { available, reason } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Apple Intelligence is not available:", reason);
    process.exit(1);
  }

  const session = new LanguageModelSession({
    instructions: [
      "You are a contact information parser.",
      "Extract structured contact details from messy, informal text.",
      "Infer field types from context: 'c:' or 'cell' means mobile phone,",
      "city abbreviations should be expanded, and relationship context should",
      "capture where/how the contact was acquired.",
      "Set confidence lower when you have to guess or infer fields.",
    ].join(" "),
    model,
  });

  session.prewarm("Parse the following contact information");

  console.log("Contact Card Parser — on-device, private extraction\n");

  const parsed: ContactCardData[] = [];

  for (const sample of sampleContacts) {
    console.log(`[${sample.label}]`);
    console.log(sample.text);
    console.log();

    const { content } = await session.respondWithSchema(
      `Parse this contact info:\n\n${sample.text}`,
      ContactCard.schema,
    );
    const card = ContactCard.parse(content);
    parsed.push(card);

    console.log(formatContactCard(card));
    console.log();
  }

  // Natural-language summary using the same session (context carries over)
  const { content: summary } = await session.respond(
    `You just parsed ${parsed.length} contacts. Give a brief summary: ` +
      `how many had complete info, which fields were you least confident about, ` +
      `and any details that seemed ambiguous.`,
  );

  console.log("--- Summary ---");
  console.log(summary);

  session.dispose();
  model.dispose();
}

main().catch(console.error);
