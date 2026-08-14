/**
 * Email Priority Triage with Draft Replies
 *
 * Feed inbox emails through on-device AI for priority triage, then stream
 * reply drafts with interactive refinement — nothing leaves your machine.
 *
 * Demonstrates:
 * - respondWithJsonSchema() with a complex raw JSON Schema
 * - Per-call GenerationOptions (low temp for classification, higher for drafts)
 * - streamResponse() for draft generation
 * - cancel() for interrupting a draft mid-stream
 * - Multi-turn refinement ("make it shorter" / "more formal")
 * - Tools: fetch_emails loads inbox, save_draft persists the reply
 */

import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline";

import {
  LanguageModelSession,
  SystemLanguageModel,
  GenerationSchema,
  GeneratedContent,
  Tool,
  type JsonSchema,
} from "tsfm-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Email {
  id: string;
  from: string;
  subject: string;
  date: string;
  body: string;
}

export interface TriageResult {
  email_id: string;
  sender: string;
  subject: string;
  summary: string;
  priority: number;
  category: string;
  suggested_action: string;
}

// ---------------------------------------------------------------------------
// JSON Schema for triage (raw, not generable — shows the other API path)
// ---------------------------------------------------------------------------

export const triageSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          email_id: { type: "string", description: "The email's id field" },
          sender: { type: "string", description: "Sender name (no email address)" },
          subject: { type: "string" },
          summary: { type: "string", description: "One-sentence summary of what the email needs" },
          priority: {
            type: "integer",
            description: "1 = urgent/time-sensitive, 5 = ignorable",
            minimum: 1,
            maximum: 5,
          },
          category: {
            type: "string",
            enum: ["action-required", "fyi", "scheduling", "personal", "promotional"],
          },
          suggested_action: {
            type: "string",
            enum: ["reply-now", "reply-later", "delegate", "archive", "unsubscribe"],
          },
        },
        required: [
          "email_id",
          "sender",
          "subject",
          "summary",
          "priority",
          "category",
          "suggested_action",
        ],
      },
    },
  },
  required: ["results"],
} satisfies JsonSchema;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export class FetchEmailsTool extends Tool {
  readonly name = "fetch_emails";
  readonly description =
    "Fetch unread emails from the inbox. Call this when asked to check or triage emails.";
  readonly argumentsSchema = new GenerationSchema("FetchEmailsArgs", "No arguments needed");

  private emails: Email[];

  constructor(emails: Email[]) {
    super();
    this.emails = emails;
  }

  async call(_args: GeneratedContent): Promise<string> {
    return JSON.stringify(this.emails, null, 2);
  }
}

export class SaveDraftTool extends Tool {
  readonly name = "save_draft";
  readonly description = "Save a finalized reply draft. Call this when the user approves a draft.";

  readonly argumentsSchema = new GenerationSchema("SaveDraftArgs", "Draft to save")
    .property("email_id", "string", { description: "ID of the email being replied to" })
    .property("draft", "string", { description: "The reply text" });

  readonly savedDrafts: Array<{ emailId: string; draft: string }> = [];

  async call(args: GeneratedContent): Promise<string> {
    const emailId = args.value<string>("email_id");
    const draft = args.value<string>("draft");
    this.savedDrafts.push({ emailId, draft });
    return `Draft saved for email ${emailId}`;
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const priorityLabels: Record<number, string> = {
  1: "🔴 URGENT",
  2: "🟠 HIGH",
  3: "🟡 MEDIUM",
  4: "🔵 LOW",
  5: "⚪ SKIP",
};

const actionLabels: Record<string, string> = {
  "reply-now": "↩️  Reply now",
  "reply-later": "⏰ Reply later",
  delegate: "👋 Delegate",
  archive: "📦 Archive",
  unsubscribe: "🚫 Unsubscribe",
};

export function formatTriage(results: TriageResult[]): string {
  const sorted = [...results].sort((a, b) => a.priority - b.priority);
  const lines: string[] = [];

  for (const r of sorted) {
    const pLabel = priorityLabels[r.priority] ?? `P${r.priority}`;
    const aLabel = actionLabels[r.suggested_action] ?? r.suggested_action;
    lines.push(`${pLabel}  ${r.subject}`);
    lines.push(`  from: ${r.sender}  |  ${r.category}`);
    lines.push(`  ${r.summary}`);
    lines.push(`  → ${aLabel}`);
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function loadSampleEmails(): Email[] {
  const dir = dirname(fileURLToPath(import.meta.url));
  const raw = readFileSync(join(dir, "sample-inbox.json"), "utf-8");
  return JSON.parse(raw);
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const auto = process.argv.includes("--test");
  const emails = loadSampleEmails();

  const model = new SystemLanguageModel();
  const { available, reason } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Apple Intelligence is not available:", reason);
    process.exit(1);
  }

  const fetchTool = new FetchEmailsTool(emails);
  fetchTool.onCall = () => console.log("  📬 Fetching emails...");

  const saveTool = new SaveDraftTool();
  saveTool.onCall = () => console.log("  💾 Saving draft...");

  const session = new LanguageModelSession({
    instructions: [
      "You are an email triage assistant. When asked to check emails, use the",
      "fetch_emails tool. Prioritize by urgency and actionability. When the user",
      "approves a reply draft, use the save_draft tool to save it.",
    ].join(" "),
    model,
    tools: [fetchTool, saveTool],
  });

  console.log("Email Triage — on-device, private inbox processing\n");

  // Phase 1: Fetch + triage (low temperature for consistent classification)
  const triagePrompt =
    "Check my inbox and triage each email. For each one, assess priority (1=urgent, 5=ignorable), " +
    "categorize it, suggest an action, and write a one-sentence summary.";

  const triageContent = await session.respondWithJsonSchema(triagePrompt, triageSchema, {
    options: { temperature: 0.2 },
  });
  const triage = triageContent.toObject<{ results: TriageResult[] }>();

  console.log("--- Inbox Triage ---\n");
  console.log(formatTriage(triage.results));

  // Phase 2: Draft reply for highest-priority "reply-now" email
  const replyTarget = [...triage.results]
    .sort((a, b) => a.priority - b.priority)
    .find((r) => r.suggested_action === "reply-now");

  if (replyTarget) {
    console.log(`--- Drafting reply to: ${replyTarget.subject} ---\n`);

    // Stream draft with higher temperature for creative writing
    let draft = "";
    for await (const chunk of session.streamResponse(
      `Draft a concise, friendly reply to the email from ${replyTarget.sender} ` +
        `about "${replyTarget.subject}". Keep it under 3 sentences.`,
      { options: { temperature: 0.7, maximumResponseTokens: 300 } },
    )) {
      process.stdout.write(chunk);
      draft += chunk;
    }
    console.log("\n");

    // Multi-turn refinement
    if (!auto) {
      let refining = true;
      while (refining) {
        const feedback = await prompt(
          'Refine? (e.g., "shorter", "more formal", or Enter to accept): ',
        );
        if (!feedback.trim()) {
          refining = false;
        } else {
          draft = "";
          for await (const chunk of session.streamResponse(
            `Rewrite the draft: ${feedback.trim()}`,
            { options: { temperature: 0.7, maximumResponseTokens: 300 } },
          )) {
            process.stdout.write(chunk);
            draft += chunk;
          }
          console.log("\n");
        }
      }
    }

    // Save the draft via tool
    await session.respond(
      `The user approved the draft reply to email ${replyTarget.email_id}. ` +
        `Save it using the save_draft tool. The draft is: ${draft}`,
    );
  }

  // Phase 3: Summary
  const summary = await session.respond(
    "Give a one-line summary of the triage: how many emails, how many need replies, " +
      "and how many can be archived.",
  );
  console.log("--- Summary ---");
  console.log(summary);

  session.dispose();
  fetchTool.dispose();
  saveTool.dispose();
  model.dispose();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
