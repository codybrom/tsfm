/**
 * Private Journal with Mood Tracking
 *
 * A journaling tool that extracts mood and themes from free-form entries,
 * persists them via tools, and generates reflections by querying past
 * entries — all on-device, nothing leaves your Mac.
 *
 * Demonstrates:
 * - Tool subclasses the model genuinely calls (save_entry, query_entries)
 * - onCall callback for tool invocation UI feedback
 * - generable() with anyOf, range, minItems/maxItems constraints
 * - streamResponse() for reflections
 * - Transcript persistence for session continuity
 * - Multi-turn: extract → save → query → reflect
 */

import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";

import {
  LanguageModelSession,
  SystemLanguageModel,
  GenerationSchema,
  GenerationGuide,
  GeneratedContent,
  Tool,
  generable,
  type InferSchema,
  type PropertyDef,
} from "tsfm-sdk";

// ---------------------------------------------------------------------------
// Journal storage
// ---------------------------------------------------------------------------

export interface JournalEntry {
  date: string;
  mood: string;
  intensity: number;
  themes: string[];
  summary: string;
  raw: string;
}

export class JournalStore {
  private entries: JournalEntry[] = [];
  constructor(readonly path: string) {
    if (existsSync(path)) {
      this.entries = JSON.parse(readFileSync(path, "utf-8"));
    }
  }

  add(entry: JournalEntry): void {
    this.entries.push(entry);
    writeFileSync(this.path, JSON.stringify(this.entries, null, 2));
  }

  query(afterDate?: string): JournalEntry[] {
    if (!afterDate) return [...this.entries];
    return this.entries.filter((e) => e.date >= afterDate);
  }

  get size(): number {
    return this.entries.length;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const analysisProperties = {
  mood: {
    type: "string",
    description: "Primary mood of the entry",
    guides: [
      GenerationGuide.anyOf([
        "joyful",
        "calm",
        "anxious",
        "frustrated",
        "melancholic",
        "energized",
        "grateful",
        "reflective",
      ]),
    ],
  },
  intensity: {
    type: "integer",
    description: "How strongly this mood is felt, from 1 (mild) to 10 (overwhelming)",
    guides: [GenerationGuide.range(1, 10)],
  },
  themes: {
    type: "array",
    items: { type: "string" },
    description: "Key themes or topics in the entry",
    guides: [GenerationGuide.minItems(1), GenerationGuide.maxItems(5)],
  },
  summary: {
    type: "string",
    description: "A one-sentence summary of the entry",
  },
} satisfies Record<string, PropertyDef>;

export const JournalAnalysis = generable("JournalAnalysis", analysisProperties);
export type JournalAnalysisData = InferSchema<typeof analysisProperties>;

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export class SaveEntryTool extends Tool {
  readonly name = "save_entry";
  readonly description =
    "Save a journal entry with its mood analysis. Call this after analyzing the user's journal entry.";

  readonly argumentsSchema = new GenerationSchema("SaveEntryArgs", "Journal entry to save")
    .property("date", "string", { description: "ISO date (YYYY-MM-DD)" })
    .property("mood", "string", { description: "Detected mood" })
    .property("intensity", "integer", { description: "Mood intensity 1-10" })
    .property("summary", "string", { description: "One-sentence summary" });

  private store: JournalStore;
  private rawText: string;
  private themes: string[];

  constructor(store: JournalStore, rawText: string, themes: string[]) {
    super();
    this.store = store;
    this.rawText = rawText;
    this.themes = themes;
  }

  async call(args: GeneratedContent): Promise<string> {
    const entry: JournalEntry = {
      date: args.value<string>("date"),
      mood: args.value<string>("mood"),
      intensity: args.value<number>("intensity"),
      themes: this.themes,
      summary: args.value<string>("summary"),
      raw: this.rawText,
    };
    this.store.add(entry);
    return `Saved entry for ${entry.date} (mood: ${entry.mood}, intensity: ${entry.intensity}/10)`;
  }
}

export class QueryEntryTool extends Tool {
  readonly name = "query_entries";
  readonly description =
    "Retrieve past journal entries. Use this when the user asks about patterns, " +
    "trends, or how their week/month has been.";

  readonly argumentsSchema = new GenerationSchema("QueryEntriesArgs", "Query parameters").property(
    "after_date",
    "string",
    {
      description: "Return entries on or after this ISO date (YYYY-MM-DD). Omit for all entries.",
      optional: true,
    },
  );

  private store: JournalStore;

  constructor(store: JournalStore) {
    super();
    this.store = store;
  }

  async call(args: GeneratedContent): Promise<string> {
    let afterDate: string | undefined;
    try {
      afterDate = args.value<string>("after_date");
    } catch {
      // optional field — if missing, return all
    }
    const entries = this.store.query(afterDate);
    if (entries.length === 0) return "No journal entries found.";
    return entries
      .map(
        (e) =>
          `[${e.date}] mood: ${e.mood} (${e.intensity}/10) | themes: ${e.themes.join(", ")} | ${e.summary}`,
      )
      .join("\n");
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatAnalysis(analysis: JournalAnalysisData): string {
  const moodIcons: Record<string, string> = {
    joyful: "😊",
    calm: "😌",
    anxious: "😰",
    frustrated: "😤",
    melancholic: "😢",
    energized: "⚡",
    grateful: "🙏",
    reflective: "🤔",
  };
  const icon = moodIcons[analysis.mood] ?? "📝";
  const bar = "█".repeat(analysis.intensity) + "░".repeat(10 - analysis.intensity);

  const lines = [
    `${icon} ${analysis.mood} [${bar}] ${analysis.intensity}/10`,
    `  themes: ${analysis.themes.join(", ")}`,
    `  ${analysis.summary}`,
  ];
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const defaultEntry = `
Had a really productive morning — finally finished the migration I've been
putting off for weeks. Took a long walk at lunch and noticed the cherry
blossoms are starting to bloom. Afternoon was slower, got stuck in a
meeting that could have been an email, but I'm trying not to let that
kind of thing get to me. Overall feeling pretty good about where things
are heading with the project.
`.trim();

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

  const model = new SystemLanguageModel();
  const { available, reason } = await model.waitUntilAvailable();
  if (!available) {
    console.error("Apple Intelligence is not available:", reason);
    process.exit(1);
  }

  // Use a temp directory for journal storage
  const storeDir = mkdtempSync(join(tmpdir(), "tsfm-journal-"));
  const storePath = join(storeDir, "entries.json");
  const store = new JournalStore(storePath);

  const today = new Date();

  // In test mode, seed a few past entries so the reflection has material
  if (auto) {
    const seed: JournalEntry[] = [
      {
        date: new Date(today.getTime() - 5 * 86400000).toISOString().slice(0, 10),
        mood: "anxious",
        intensity: 7,
        themes: ["deadline", "workload"],
        summary: "Stressed about the upcoming launch deadline.",
        raw: "Everything feels like it's piling up before the launch...",
      },
      {
        date: new Date(today.getTime() - 3 * 86400000).toISOString().slice(0, 10),
        mood: "calm",
        intensity: 5,
        themes: ["nature", "exercise"],
        summary: "Morning yoga and a quiet afternoon helped reset.",
        raw: "Started the day with yoga. Spent the afternoon reading in the garden.",
      },
      {
        date: new Date(today.getTime() - 1 * 86400000).toISOString().slice(0, 10),
        mood: "energized",
        intensity: 8,
        themes: ["project", "progress", "collaboration"],
        summary: "Great brainstorming session with the team.",
        raw: "The team came together today and we made real progress on the roadmap.",
      },
    ];
    for (const entry of seed) store.add(entry);
  }

  console.log("Private Journal — on-device mood tracking\n");

  // Get today's entry
  let entryText: string;
  if (auto) {
    entryText = defaultEntry;
    console.log("Journal entry (--test):");
  } else {
    console.log("Write your journal entry (or press Enter for a default):\n");
    const input = await prompt("> ");
    entryText = input.trim() || defaultEntry;
    console.log();
  }
  console.log(entryText);
  console.log();

  // Phase 1: Extract mood/themes
  const analysisSession = new LanguageModelSession({
    instructions:
      "You are a thoughtful journal assistant. Analyze journal entries for " +
      "emotional tone, key themes, and provide brief summaries. Be empathetic " +
      "and perceptive.",
    model,
  });

  const content = await analysisSession.respondWithSchema(
    `Analyze this journal entry:\n\n${entryText}`,
    JournalAnalysis.schema,
  );
  const analysis = JournalAnalysis.parse(content);

  console.log("--- Analysis ---");
  console.log(formatAnalysis(analysis));
  console.log();

  analysisSession.dispose();

  // Phase 2: Save + reflect with tools
  const todayStr = today.toISOString().slice(0, 10);
  const saveTool = new SaveEntryTool(store, entryText, analysis.themes);
  saveTool.onCall = (name) => console.log(`  💾 Tool: ${name}`);

  const queryTool = new QueryEntryTool(store);
  queryTool.onCall = (name) => console.log(`  🔍 Tool: ${name}`);

  const reflectSession = new LanguageModelSession({
    instructions:
      "You are a reflective journal companion. When asked to save an entry, " +
      "use the save_entry tool. When asked about past entries or patterns, " +
      "use the query_entries tool. Base your reflections only on what the " +
      "tools return — do not invent past entries.",
    model,
    tools: [saveTool, queryTool],
  });

  // Ask the model to save, then reflect
  await reflectSession.respond(
    `Save today's entry (${todayStr}). ` +
      `Mood: ${analysis.mood}, intensity: ${analysis.intensity}/10. ` +
      `Summary: ${analysis.summary}`,
  );

  console.log(`\n--- Reflection ---`);
  for await (const chunk of reflectSession.streamResponse(
    `Look up my journal entries and give me a brief, thoughtful reflection. ` +
      `If there's only one entry, reflect on that. If there are multiple, ` +
      `note any patterns in mood or themes.`,
  )) {
    process.stdout.write(chunk);
  }
  console.log();

  // Save transcript for continuity
  const transcript = reflectSession.transcript.toJson();
  console.log(
    `\nTranscript saved (${transcript.length} bytes) — use Transcript.fromJson() to resume`,
  );

  reflectSession.dispose();
  saveTool.dispose();
  queryTool.dispose();
  model.dispose();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(console.error);
}
