import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { SystemLanguageModel } from "../../src/index.js";

/*
 * tsfm must never crash its host. Each scenario in helpers/crash-scenarios.ts
 * runs in its own process: exiting or disposing with requests in flight,
 * abandoning streams to the garbage collector, and a fuzz pass over the public
 * API with malformed input. A native crash shows up here as a signal (SIGSEGV,
 * SIGILL, SIGBUS) or an uncaught exception instead of taking down the runner.
 */

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(import.meta.dirname, "helpers/crash-scenarios.ts");

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
model.dispose();
const describeIfAvailable = available ? describe : describe.skip;

function run(scenario: string) {
  const result = spawnSync(
    process.execPath,
    ["--expose-gc", path.join(root, "node_modules/tsx/dist/cli.mjs"), script, scenario],
    { cwd: root, encoding: "utf8", timeout: 170_000 },
  );
  return {
    status: result.status,
    signal: result.signal,
    output: `${result.stdout}${result.stderr}`,
  };
}

// Scenarios that exit on purpose while work is in flight.
const EXITS = [
  "exit-during-respond",
  "exit-during-stream",
  "exit-during-tool-call",
  "exit-with-queued-requests",
];

// Scenarios that finish on their own and print "survived".
const SURVIVES = [
  "dispose-during-respond",
  "dispose-during-stream",
  "dispose-with-queued-requests",
  "dispose-model-during-respond",
  "dispose-during-tool-call",
  "abandoned-stream-collected",
  "gc-with-sessions-in-flight",
  "fuzz",
];

describeIfAvailable("crash safety (integration)", () => {
  it.each(EXITS)(
    "%s exits cleanly",
    (scenario) => {
      const { status, signal, output } = run(scenario);
      expect({ status, signal }, output).toEqual({ status: 0, signal: null });
      expect(output).not.toMatch(/Uncaught|TypeError|failed:/);
    },
    180_000,
  );

  it.each(SURVIVES)(
    "%s survives",
    (scenario) => {
      const { status, signal, output } = run(scenario);
      expect({ status, signal }, output).toEqual({ status: 0, signal: null });
      expect(output).toContain("survived");
      expect(output).not.toMatch(/Uncaught|TypeError|failed:/);
    },
    180_000,
  );

  it("rejects queued requests once the session is disposed", () => {
    const { output } = run("dispose-with-queued-requests");
    // The running request finishes; the three queued behind it are refused in JS.
    expect(output).toMatch(
      /(resolved|rejected: \w+), rejected: FoundationModelsError, rejected: FoundationModelsError, rejected: FoundationModelsError/,
    );
  }, 180_000);
});
