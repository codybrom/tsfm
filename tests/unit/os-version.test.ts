import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { macOSMajorVersion, unsupportedOSHint } from "../../src/bindings.js";

const dir = mkdtempSync(join(tmpdir(), "tsfm-os-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function plist(productVersion: string): string {
  const path = join(dir, `SystemVersion-${productVersion}.plist`);
  writeFileSync(
    path,
    `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
	<key>ProductName</key>
	<string>macOS</string>
	<key>ProductVersion</key>
	<string>${productVersion}</string>
</dict>
</plist>`,
  );
  return path;
}

describe("macOSMajorVersion", () => {
  it("reads the major version from SystemVersion.plist", () => {
    expect(macOSMajorVersion(plist("27.0"))).toBe(27);
    expect(macOSMajorVersion(plist("26.4.1"))).toBe(26);
  });

  it("returns null when the plist can't be read", () => {
    expect(macOSMajorVersion(join(dir, "missing.plist"))).toBeNull();
  });
});

describe.runIf(process.platform === "darwin")("unsupportedOSHint", () => {
  it("points macOS 26 users to tsfm 0.x", () => {
    expect(unsupportedOSHint(26)).toMatch(/requires macOS 27.*tsfm-sdk@0\.x/);
  });

  it("adds nothing on macOS 27 or later", () => {
    expect(unsupportedOSHint(27)).toBe("");
    expect(unsupportedOSHint(28)).toBe("");
  });

  it("adds nothing when the version is unknown", () => {
    expect(unsupportedOSHint(null)).toBe("");
  });
});
