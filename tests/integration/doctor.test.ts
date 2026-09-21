import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  realpathSync,
  statSync,
  cpSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
let install: string;

// Lay out the compiled CLI the way `npm install` does: package.json, dist/,
// native/, dependencies, and an executable bin symlink.
beforeAll(() => {
  install = realpathSync(mkdtempSync(path.join(tmpdir(), "tsfm-doctor-")));
  // Copy what the build produced, rather than compiling again: the point is to
  // run the artifact that ships, file modes included. Recompiling here hid a
  // missing execute bit, because the test then set one of its own.
  const built = path.join(root, "dist");
  if (!existsSync(path.join(built, "cli/doctor.js"))) {
    throw new Error(`No build to test: ${built}/cli/doctor.js is missing. Run npm run build.`);
  }
  cpSync(built, path.join(install, "dist"), { recursive: true });
  copyFileSync(path.join(root, "package.json"), path.join(install, "package.json"));
  mkdirSync(path.join(install, "native"));
  symlinkSync(
    path.join(root, "native/libFoundationModels.dylib"),
    path.join(install, "native/libFoundationModels.dylib"),
  );
  symlinkSync(path.join(root, "native/tsfm.node"), path.join(install, "native/tsfm.node"));
  symlinkSync(path.join(root, "node_modules"), path.join(install, "node_modules"));
  mkdirSync(path.join(install, "bin"));
  symlinkSync("../dist/cli/doctor.js", path.join(install, "bin/tsfm"));
}, 120_000);

afterAll(() => rmSync(install, { recursive: true, force: true }));

describe("tsfm doctor (integration)", () => {
  it("is built executable, so npm's bin symlink runs it", () => {
    // The build sets this: tsc emits 0644, and a published package whose bin
    // isn't executable fails with "permission denied".
    const mode = statSync(path.join(root, "dist/cli/doctor.js")).mode & 0o111;
    expect(mode).not.toBe(0);
  });

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
