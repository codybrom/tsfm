/**
 * Records one `fm` CLI run into a fixture JSON file (see README.md).
 *
 *   npx tsx tests/fixtures/fm/probe.ts <file.json> <name> <null|pipe|tty> -- <fm args...>
 *
 * Never run this as root: agreeing to the fm license applies to the whole machine.
 * Set EXPECT_UNLICENSED=1 to warn if a run creates the license plist.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";

type StdinMode = "null" | "pipe" | "tty";

export interface FmRun {
  name: string;
  argv: string[];
  stdin: StdinMode;
  exitCode: number;
  seconds: number;
  stdout: string;
  stderr: string;
  /** Pty transcript from script(1), only when it differs from stdout. */
  tty?: string;
}

export interface FmCapture {
  description: string;
  capturedOn: string;
  os: string;
  fmSha256Prefix: string;
  user: string;
  licensed: boolean;
  runs: FmRun[];
}

const LICENSE_PLIST = "/Library/Preferences/com.apple.fm.plist";
const TIMEOUT_MS = 10_000;

/** Strips machine-specific details so fixtures are safe to publish. */
export function redact(text: string): string {
  return text
    .replaceAll(tmpdir(), "<tmp>")
    .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/\S*?\/(?=[^/\s]+\.sock\b)/g, "<scratch-dir>/")
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/on \w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2}(\u202f)([AP]M)/g, "on <date> at <time>$1$2");
}

function record(name: string, mode: StdinMode, args: string[]): FmRun {
  const scratch = mkdtempSync(join(tmpdir(), "fm-probe-"));
  const ttyFile = join(scratch, "tty.txt");
  const [command, commandArgs] =
    mode === "tty" ? ["script", ["-q", ttyFile, "fm", ...args]] : ["fm", args];
  const started = performance.now();
  const result = spawnSync(command, commandArgs, {
    input: mode === "null" ? undefined : "no\n",
    stdio: [mode === "null" ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: TIMEOUT_MS,
    encoding: "utf8",
  });
  const seconds = Math.round(performance.now() - started) / 1000;
  const tty = existsSync(ttyFile) ? readFileSync(ttyFile, "utf8") : undefined;
  rmSync(scratch, { recursive: true, force: true });

  const run: FmRun = {
    name,
    argv: args.map(redact),
    stdin: mode,
    exitCode: result.status ?? 124,
    seconds,
    stdout: redact(result.stdout ?? ""),
    stderr: redact(result.stderr ?? ""),
  };
  if (tty !== undefined && redact(tty) !== run.stdout) run.tty = redact(tty);
  return run;
}

async function main(): Promise<void> {
  const [file, name, mode, separator, ...args] = process.argv.slice(2);
  if (!file || !name || !["null", "pipe", "tty"].includes(mode) || separator !== "--") {
    console.error("usage: probe.ts <file.json> <name> <null|pipe|tty> -- <fm args...>");
    process.exit(64);
  }
  if (process.getuid?.() === 0) {
    console.error("refusing to run as root: agreeing to the fm license is machine-wide");
    process.exit(64);
  }

  const run = record(name, mode as StdinMode, args);
  if (process.env.EXPECT_UNLICENSED && existsSync(LICENSE_PLIST)) {
    console.error(`!!! ${LICENSE_PLIST} appeared after ${name}`);
  }

  const capture: FmCapture = JSON.parse(readFileSync(file, "utf8"));
  const index = capture.runs.findIndex((r) => r.name === name);
  if (index === -1) capture.runs.push(run);
  else capture.runs[index] = run;
  capture.runs.sort((a, b) => a.name.localeCompare(b.name));

  const options = { ...(await resolveConfig(file)), parser: "json" };
  writeFileSync(file, await format(JSON.stringify(capture), options));
  console.log(
    `${name.padEnd(32)} ${mode.padEnd(5)} exit=${String(run.exitCode).padEnd(4)} ${run.seconds}s ` +
      `out=${run.stdout.length} err=${run.stderr.length}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
