import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

describe("tsfm doctor (integration)", () => {
  it("reports this machine and exits 0 when tsfm can run", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/doctor.ts"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.stdout).toMatch(/✓ macOS\s+macOS 2[7-9]/);
    expect(result.stdout).toMatch(/✓ Native library\s+loaded/);
    expect(result.stdout).toMatch(/On-device model/);
    expect(result.stdout).toMatch(/Private Cloud Compute/);
    // Never agrees to the fm license, only reads it.
    expect(result.stdout).toMatch(/fm CLI/);
    expect(result.status).toBe(result.stdout.includes("✗") ? 1 : 0);
  }, 60_000);
});
