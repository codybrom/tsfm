/**
 * Records one `fm` CLI run into a fixture JSON file (see README.md).
 *
 *   npx tsx tests/fixtures/fm/probe.ts <file.json> <name> <null|pipe|tty> -- <fm args...>
 *
 * Never run this as root: agreeing to the fm license applies to the whole machine.
 * Set EXPECT_UNLICENSED=1 to warn if a run creates the license plist.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { format, resolveConfig } from "prettier";

type StdinMode = "null" | "pipe" | "tty";

export interface FmRun {
  name: string;
  argv: string[];
  stdin: StdinMode;
  /** 124 = killed by the timeout; 128+N = ended by signal N (see `signal`). */
  exitCode: number;
  /** Set when a signal other than the timeout ended the run. */
  signal?: string;
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

/**
 * Strips machine-specific details and Apple's license terms so fixtures are safe to publish.
 * Idempotent, so it can be re-run over existing fixtures.
 */
export function redact(text: string): string {
  return (
    text
      .replaceAll(tmpdir(), "<tmp>")
      .replace(/\/(?:private\/)?(?:tmp|var\/folders)\/\S*?\/(?=[^/\s]+\.sock\b)/g, "<scratch-dir>/")
      .replace(/\/Users\/[^/\s]+/g, "~")
      // `fm license` prints the full terms. The short "YOU HAVE NOT AGREED\u2026" notice is kept.
      .replace(
        /LEGAL NOTICE & TERMS\r?\n\r?\nPLEASE READ[\s\S]*?DO NOT USE THE APPLE FOUNDATION\s+MODELS CLI\.(\r?\n)/g,
        "<license terms omitted>$1",
      )
      // The agreement time in `fm license --status`. The en-US form keeps its U+202F as evidence.
      .replace(
        /on \w{3} \d{1,2}, \d{4} at \d{1,2}:\d{2}(\u202f)([AP]M)/g,
        "on <date> at <time>$1$2",
      )
      // Any other locale's layout: redact whatever follows "on".
      .replace(/(Agreed to license \S+ version \S+ on )(?!<date>)[^\r\n]*/g, "$1<date>.")
  );
}

/** The pid plus every descendant. script(1) moves fm into its own session, so a group kill misses it. */
function processTree(pid: number): number[] {
  const children = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
    .stdout.split("\n")
    .filter(Boolean)
    .map(Number);
  return [pid, ...children.flatMap(processTree)];
}

function killTree(pid: number): void {
  for (const p of processTree(pid).reverse()) {
    try {
      process.kill(p, "SIGKILL");
    } catch {
      // Already exited.
    }
  }
}

async function record(name: string, mode: StdinMode, args: string[]): Promise<FmRun> {
  const scratch = mkdtempSync(join(tmpdir(), "fm-probe-"));
  const ttyFile = join(scratch, "tty.txt");
  const fmCommand = mode === "tty" ? ["script", "-q", ttyFile, "fm", ...args] : ["fm", ...args];
  // Node's "pipe" stdio is a socket pair, and script(1) can't run on one (tcgetattr fails),
  // so stdin comes through a real shell pipe, the same as `echo no | fm …`.
  const [command, ...commandArgs] =
    mode === "null" ? fmCommand : ["/bin/sh", "-c", 'echo no | exec "$@"', "sh", ...fmCommand];
  const started = performance.now();
  try {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));

    // SIGKILL can't be caught or ignored, so the limit is hard for fm and anything it spawned.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) killTree(child.pid);
    }, TIMEOUT_MS);
    // A spawn failure (e.g. ENOENT) rejects here, so no fixture gets written for it.
    const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (c, s) => resolve([c, s]));
      },
    ).finally(() => clearTimeout(timer));

    const seconds = Math.round(performance.now() - started) / 1000;
    const tty = existsSync(ttyFile) ? readFileSync(ttyFile, "utf8") : undefined;
    const run: FmRun = {
      name,
      argv: args.map(redact),
      stdin: mode,
      exitCode: timedOut ? 124 : (code ?? 128 + (signal ? constants.signals[signal] : 0)),
      seconds,
      stdout: redact(stdout),
      stderr: redact(stderr),
    };
    if (signal && !timedOut) run.signal = signal;
    if (tty !== undefined && redact(tty) !== run.stdout) run.tty = redact(tty);
    return run;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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

  // Piped and pty runs start through /bin/sh, where a missing binary would only show up as exit 127.
  for (const bin of mode === "tty" ? ["fm", "script"] : ["fm"]) {
    if (spawnSync("/bin/sh", ["-c", `command -v ${bin}`]).status !== 0) {
      console.error(`${name}: ${bin} not found on PATH`);
      process.exit(70);
    }
  }

  const run = await record(name, mode as StdinMode, args).catch((error: Error) => {
    console.error(`${name}: could not run ${mode === "tty" ? "script" : "fm"}: ${error.message}`);
    process.exit(70);
  });
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
