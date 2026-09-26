#!/usr/bin/env node
/**
 * `tsfm doctor` reports whether this machine can run tsfm, and why not.
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
  /** true means fine, false a problem, and null informational. */
  ok: boolean | null;
  detail: string;
}

/** What the on-device model reports about itself when it's available. */
interface OnDeviceModelMetadata {
  variant: string | null;
  contextSize: number;
  capabilities: string[] | null;
}

/**
 * @internal Turn the on-device model's state into the doctor's health check.
 * Pass the framework's unavailable reason as a string, or the model's
 * metadata when it reports itself available.
 */
export function onDeviceModelCheck(state: string | OnDeviceModelMetadata): DoctorCheck {
  const label = "On-device model";
  if (typeof state === "string") {
    return { label, ok: false, detail: `unavailable: ${state}` };
  }
  const detail = [
    state.variant,
    `${state.contextSize}-token context`,
    state.capabilities?.length ? `capabilities: ${state.capabilities.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  // isAvailable() only says the model is installed and the device eligible.
  // A zero-token context means the runtime is refusing work.
  if (state.contextSize === 0) {
    return {
      label,
      ok: false,
      detail:
        `${detail}. Installed, but the model runtime is not accepting requests. Retry in a ` +
        "few minutes. If it persists, free memory, then log out or restart",
    };
  }
  return { label, ok: true, detail };
}

/**
 * Whether the hardware is Apple silicon, whatever architecture this process
 * runs as. `hw.optional.arm64` is 1 on an Apple silicon Mac even for an x64
 * process under Rosetta, so it tells the Mac apart from the Node.js binary.
 * Null when it can't be read.
 */
function hardwareIsAppleSilicon(): boolean | null {
  const result = spawnSync("sysctl", ["-n", "hw.optional.arm64"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  if (result.error || result.status !== 0) return null;
  return result.stdout.trim() === "1";
}

/**
 * @internal The Apple silicon check. Foundation Models needs an arm64 process
 * on an Apple silicon Mac, and an x64 Node.js on one is a different problem
 * from an Intel Mac, so the two are reported apart.
 */
export function appleSiliconCheck(arch: string, hardware: boolean | null): DoctorCheck {
  const label = "Apple silicon";
  if (arch === "arm64") return { label, ok: true, detail: "yes" };
  if (hardware) {
    return {
      label,
      ok: false,
      detail: `this Mac is Apple silicon, but Node.js is ${arch} (running under Rosetta?). Install an arm64 Node.js`,
    };
  }
  return { label, ok: false, detail: `${arch}, Apple Intelligence needs Apple silicon` };
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
  if (result.error) {
    // spawnSync reports more than a missing binary: a timeout, or a spawn that
    // was refused. Only ENOENT means it isn't installed.
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return "fm CLI not found (not needed by tsfm)";
    return `fm CLI found, but couldn't be run (${code ?? result.error.message}), not needed by tsfm`;
  }
  if (result.status === 0) return "installed, license agreed";
  // 69 is what `fm license --status` exits with before the license is agreed,
  // in every stdin mode (see tests/fixtures/fm/unlicensed.json, recorded on
  // macOS 27.0 before this machine agreed). Its stderr is also where the
  // remediation comes from: agreeing is the user's decision, and `fm license`
  // records it for every user on the machine, hence sudo.
  if (result.status === 69) {
    return "installed, license not agreed (not needed by tsfm - to agree, run: sudo fm license)";
  }
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
    ok: process.platform === "darwin" && macOS !== null && macOS >= 26,
    detail:
      process.platform !== "darwin"
        ? `tsfm needs macOS, found ${process.platform}`
        : macOS === null
          ? "version unknown"
          : macOS >= 27
            ? `macOS ${macOS}`
            : macOS === 26
              ? "macOS 26 (supported). Token usage, toolCallingMode, Private Cloud Compute, " +
                "attachments and model info need macOS 27, and token counting needs 26.4"
              : `macOS ${macOS}, tsfm needs macOS 26 or later`,
  });
  if (process.platform === "darwin") {
    checks.push(
      appleSiliconCheck(process.arch, process.arch === "arm64" ? true : hardwareIsAppleSilicon()),
    );
  }

  let core: typeof import("../index.js") | null = null;
  // Tracks whether the library itself loaded, so a failure after that is
  // reported under its own label instead of contradicting the "loaded" row.
  let loaded = false;
  try {
    core = await import("../index.js");
    const model = new core.SystemLanguageModel();
    checks.push({ label: "Native library", ok: true, detail: "loaded" });
    loaded = true;

    const availability = model.isAvailable();
    checks.push(
      onDeviceModelCheck(
        availability.available
          ? {
              variant: model.variant,
              contextSize: model.contextSize,
              capabilities: model.capabilities,
            }
          : (core.SystemLanguageModelUnavailableReason[availability.reason ?? 0xff] ?? "UNKNOWN"),
      ),
    );
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
            : pccAvailability.reason === core.PrivateCloudComputeUnavailableReason.REQUIRES_NEWER_OS
              ? " (needs macOS 27, PCC is optional)"
              : ""),
    });
    pcc.dispose();
  } catch (err) {
    checks.push({
      label: loaded ? "Model checks" : "Native library",
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

/** @internal */
export async function main(): Promise<void> {
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
