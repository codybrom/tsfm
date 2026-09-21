/** Repeat native lifecycle regressions in isolated processes, with a reproducible order.
 * Usage: TSFM_STRESS_ROUNDS=10 TSFM_STRESS_SEED=41 npm run test:stress
 * Each child has a hard timeout; crashes, hangs and failed assertions fail the run.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const rounds = Number(process.env.TSFM_STRESS_ROUNDS ?? 10);
const seed = Number(process.env.TSFM_STRESS_SEED ?? 41);
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 100) {
  throw new Error("TSFM_STRESS_ROUNDS must be an integer from 1 to 100");
}
if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
  throw new Error("TSFM_STRESS_SEED must be an unsigned 32-bit integer");
}
let state = seed;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x1_0000_0000;
};
const scenarios = [
  "shared-tool-budgets",
  "shared-tool-lifetime",
  "shared-tool-four-sessions",
  "cancel-shared-tool",
  "cancel-stream-reuse-late-tool",
  "cancel-stream-reuse-disposed-tool",
  "cancel-text-reuse-late-tool",
  "cancel-schema-reuse-late-tool",
  "cancel-json-reuse-late-tool",
];
const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "tests/integration/helpers/crash-scenarios.ts");
const started = performance.now();
let passed = 0;
console.log(
  `Native tool stress: seed=${seed}, rounds=${rounds}, cases=${rounds * scenarios.length}`,
);
for (let round = 1; round <= rounds; round++) {
  const order = [...scenarios];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const name of order) {
    const start = performance.now();
    const cancelDelay = [0, 1, 10][Math.floor(random() * 3)];
    const lateDelay = [0, 1, 10, 100, 500][Math.floor(random() * 5)];
    const child = spawnSync(process.execPath, ["--expose-gc", "--import", "tsx", script, name], {
      cwd: root,
      env: {
        ...process.env,
        TSFM_STRESS_CANCEL_MS: String(cancelDelay),
        TSFM_STRESS_LATE_MS: String(lateDelay),
      },
      encoding: "utf8",
      timeout: 90_000,
    });
    const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
    if (child.status !== 0 || child.signal || child.error || !output.includes("survived")) {
      console.error(
        `FAILED round=${round}, scenario=${name}, seed=${seed}, cancelDelay=${cancelDelay}, lateDelay=${lateDelay}`,
      );
      console.error({ status: child.status, signal: child.signal, error: child.error?.message });
      console.error(output);
      process.exit(1);
    }
    passed++;
    console.log(
      `PASS ${passed}/${rounds * scenarios.length} round=${round} ${name} (${Math.round(performance.now() - start)}ms)`,
    );
  }
}
console.log(
  `Passed ${passed} native stress cases in ${Math.round((performance.now() - started) / 1000)}s (seed=${seed}).`,
);
