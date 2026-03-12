import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

function findExamples(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findExamples(full));
    } else if (entry.endsWith(".ts")) {
      results.push(full);
    }
  }
  return results.sort();
}

const examples = findExamples("examples");
const name = process.argv[2];

if (!name) {
  console.log("Usage: npm run example -- <name>\n");
  console.log("Available examples:");
  for (const f of examples) console.log(`  ${basename(f, ".ts")}`);
  console.log(
    "\nNote: openai-real, responses-real, and responses-advanced-real require OPENAI_API_KEY in .env.local",
  );
  console.log("See .env.local.example for setup.");
  process.exit(1);
}

if (name === "all") {
  for (const f of examples) {
    const label = basename(f, ".ts");
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${label}`);
    console.log(`${"=".repeat(60)}\n`);
    try {
      execFileSync("tsx", ["--env-file=.env.local", f], { stdio: "inherit" });
    } catch {
      console.error(`\n[${label}] failed\n`);
    }
  }
  process.exit(0);
}

const match = examples.find((f) => basename(f, ".ts") === name);
if (!match) {
  console.log(`Unknown example: ${name}\n`);
  console.log("Available examples:");
  for (const f of examples) console.log(`  ${basename(f, ".ts")}`);
  process.exit(1);
}

execFileSync("tsx", ["--env-file=.env.local", match], { stdio: "inherit" });
