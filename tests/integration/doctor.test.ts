import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
let install: string;

// Lay out the compiled CLI the way `npm install` does: package.json, dist/,
// native/, dependencies, and an executable bin symlink.
beforeAll(() => {
  install = realpathSync(mkdtempSync(path.join(tmpdir(), "tsfm-doctor-")));
  // The project's compiler, whichever package provides it.
  const tsc = spawnSync(
    path.join(root, "node_modules/.bin/tsc"),
    ["-p", path.join(root, "tsconfig.build.json"), "--outDir", path.join(install, "dist")],
    { encoding: "utf8" },
  );
  if (tsc.status !== 0) throw new Error(`tsc failed:\n${tsc.stdout}${tsc.stderr}`);
  copyFileSync(path.join(root, "package.json"), path.join(install, "package.json"));
  mkdirSync(path.join(install, "native"));
  symlinkSync(
    path.join(root, "native/libFoundationModels.dylib"),
    path.join(install, "native/libFoundationModels.dylib"),
  );
  symlinkSync(path.join(root, "node_modules"), path.join(install, "node_modules"));
  chmodSync(path.join(install, "dist/cli/doctor.js"), 0o755);
  mkdirSync(path.join(install, "bin"));
  symlinkSync("../dist/cli/doctor.js", path.join(install, "bin/tsfm"));
}, 120_000);

afterAll(() => rmSync(install, { recursive: true, force: true }));

describe("tsfm doctor (integration)", () => {
  it("runs as the published bin, through npm's symlink", () => {
    const result = spawnSync(path.join(install, "bin/tsfm"), ["doctor"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(result.stdout).toMatch(/✓ macOS\s+macOS 2[7-9]/);
    expect(result.stdout).toMatch(/✓ Native library\s+loaded/);
    expect(result.stdout).toMatch(/On-device model/);
    expect(result.stdout).toMatch(/Private Cloud Compute/);
    // Reads the fm license status only; never agrees.
    expect(result.stdout).toMatch(/fm CLI/);
    expect(result.status).toBe(result.stdout.includes("✗") ? 1 : 0);
  }, 60_000);

  it("exits 64 on an unknown command", () => {
    const result = spawnSync(path.join(install, "bin/tsfm"), ["frobnicate"], { encoding: "utf8" });
    expect(result.status).toBe(64);
    expect(result.stderr).toMatch(/Usage: tsfm doctor/);
  });
});
