#!/usr/bin/env node
/**
 * `tsfm doctor` — reports whether this machine can run tsfm, and why not.
 *
 * Read-only: it never changes settings, downloads models, or agrees to the fm
 * CLI's license (it only reads `fm license --status`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { macOSMajorVersion } from "../bindings.js";

export interface DoctorCheck {
  label: string;
  /** true: fine; false: a problem; null: informational. */
  ok: boolean | null;
  detail: string;
}

function tsfmVersion(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of ["../../package.json", "../../../package.json"]) {
    const file = path.join(here, candidate);
    if (existsSync(file)) {
      const pkg = JSON.parse(readFileSync(file, "utf8")) as { name?: string; version?: string };
      if (pkg.name === "tsfm-sdk") return pkg.version ?? "unknown";
    }
  }
  return "unknown";
}

function fmLicenseStatus(): string {
  const result = spawnSync("fm", ["license", "--status"], {
    stdio: ["ignore", "ignore", "ignore"],
    timeout: 5_000,
  });
  if (result.error) return "fm CLI not found (not needed by tsfm)";
  if (result.status === 0) return "installed, license agreed";
  if (result.status === 69) return "installed, license not agreed (not needed by tsfm)";
  return `installed, license status unknown (exit ${result.status})`;
}

/** Runs every check. The native library is loaded lazily, so a failure is reported, not thrown. */
export async function collectDoctorReport(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const macOS = macOSMajorVersion();

  checks.push({ label: "tsfm", ok: null, detail: tsfmVersion() });
  checks.push({ label: "Node.js", ok: null, detail: `${process.version} (${process.arch})` });
  checks.push({
    label: "macOS",
    ok: process.platform === "darwin" && macOS !== null && macOS >= 27,
    detail:
      process.platform !== "darwin"
        ? `${process.platform} — tsfm needs macOS`
        : macOS === null
          ? "version unknown"
          : macOS >= 27
            ? `macOS ${macOS}`
            : `macOS ${macOS} — tsfm 1.x needs macOS 27; use tsfm-sdk@0.x`,
  });
  if (process.platform === "darwin") {
    checks.push({
      label: "Apple silicon",
      ok: process.arch === "arm64",
      detail:
        process.arch === "arm64"
          ? "yes"
          : `${process.arch} — Apple Intelligence needs Apple silicon`,
    });
  }

  let core: typeof import("../index.js") | null = null;
  try {
    core = await import("../index.js");
    const model = new core.SystemLanguageModel();
    checks.push({ label: "Native library", ok: true, detail: "loaded" });

    const availability = model.isAvailable();
    checks.push({
      label: "On-device model",
      ok: availability.available,
      detail: availability.available
        ? `${model.variant}, ${model.contextSize}-token context, ` +
          `capabilities: ${model.capabilities.join(", ")}`
        : `unavailable: ${core.SystemLanguageModelUnavailableReason[availability.reason ?? 0xff]}`,
    });
    model.dispose();

    const pcc = new core.PrivateCloudComputeLanguageModel();
    const pccAvailability = pcc.isAvailable();
    checks.push({
      label: "Private Cloud Compute",
      ok: null,
      detail: pccAvailability.available
        ? "available (this process has the PCC entitlement)"
        : `not available: ${core.PrivateCloudComputeUnavailableReason[pccAvailability.reason ?? 0xff]}` +
          (pccAvailability.reason === core.PrivateCloudComputeUnavailableReason.ENTITLEMENT_MISSING
            ? " (expected for plain node; PCC is optional)"
            : ""),
    });
    pcc.dispose();
  } catch (err) {
    checks.push({
      label: "Native library",
      ok: false,
      detail: err instanceof Error ? err.message.split("\n").slice(0, 3).join(" ") : String(err),
    });
  }

  checks.push({ label: "fm CLI", ok: null, detail: fmLicenseStatus() });
  return checks;
}

export function formatDoctorReport(checks: DoctorCheck[]): string {
  const width = Math.max(...checks.map((c) => c.label.length));
  return checks
    .map((c) => `${c.ok === null ? "·" : c.ok ? "✓" : "✗"} ${c.label.padEnd(width)}  ${c.detail}`)
    .join("\n");
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "doctor";
  if (command !== "doctor") {
    process.stderr.write(`Unknown command: ${command}\nUsage: tsfm doctor\n`);
    process.exitCode = 64;
    return;
  }
  const checks = await collectDoctorReport();
  process.stdout.write(formatDoctorReport(checks) + "\n");
  // Fail when something tsfm needs is missing; informational checks don't count.
  process.exitCode = checks.some((c) => c.ok === false) ? 1 : 0;
}

/** Whether this file is being run directly, including through npm's bin symlink. */
function isEntryPoint(): boolean {
  try {
    return pathToFileURL(realpathSync(process.argv[1] ?? "")).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isEntryPoint()) await main();
