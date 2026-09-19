/**
 * The running macOS version, and checks for features that need macOS 27.
 *
 * tsfm supports macOS 26 and 27. Features built on macOS 27 APIs (token usage,
 * tool-calling modes, Private Cloud Compute, prompt attachments, model
 * capabilities and variant) fail on macOS 26 with an error that says so, so an
 * app can handle it; they never crash. The native bridge guards every macOS 27
 * API as well, so these checks only make the error earlier and clearer.
 */
import { readFileSync } from "node:fs";
import { UnsupportedCapabilityError } from "./errors.js";

/** The macOS release that features like token usage and Private Cloud Compute need. */
export const MACOS_27 = 27;

/**
 * The major macOS version, read from SystemVersion.plist (which reports the
 * real version even to processes built against an older SDK), or null if it
 * can't be read, e.g. off macOS.
 */
export function macOSMajorVersion(
  plist = "/System/Library/CoreServices/SystemVersion.plist",
): number | null {
  try {
    const match = /<key>ProductVersion<\/key>\s*<string>(\d+)/.exec(readFileSync(plist, "utf8"));
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

let _runtimeMacOS: number | null | undefined;

/** @internal The running macOS major version, read once. */
export function runtimeMacOSMajor(): number | null {
  if (_runtimeMacOS === undefined) _runtimeMacOS = macOSMajorVersion();
  return _runtimeMacOS;
}

/** @internal Overrides the detected version in tests; `undefined` re-detects. */
export function _setRuntimeMacOSMajorForTesting(version: number | null | undefined): void {
  _runtimeMacOS = version;
}

/**
 * Whether this Mac runs macOS 27 or later. An unknown version counts as yes:
 * the native bridge still refuses macOS 27 features on older systems.
 */
export function hasMacOS27(): boolean {
  const version = runtimeMacOSMajor();
  return version === null || version >= MACOS_27;
}

/** @internal Throws UnsupportedCapabilityError when `feature` needs macOS 27 and this Mac is older. */
export function requireMacOS27(feature: string): void {
  if (hasMacOS27()) return;
  throw new UnsupportedCapabilityError(
    `${feature} requires macOS ${MACOS_27} or later; this Mac runs macOS ${runtimeMacOSMajor()}.`,
    { requiredMacOS: MACOS_27 },
  );
}
