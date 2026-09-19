#!/bin/bash
# Prints the path to a copy of the current node binary re-stamped as built with
# the macOS 27 SDK, creating it in .build/ if needed.
#
# FoundationModels picks its behavior from the host executable's linked SDK:
# hosts built with the macOS 27 SDK get LanguageModelError, older ones (stock
# node is stamped SDK 15) get the legacy LanguageModelSession.GenerationError.
# Running the integration suite under this binary exercises the SDK 27 path
# that Electron apps and future Node releases built with Xcode 27 will take.
#
# Usage: "$(bash scripts/sdk27-node.sh)" node_modules/vitest/vitest.mjs run --project integration

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE="$(command -v node)"
# Keyed by node version, so upgrading node produces a fresh copy.
OUT="$PACKAGE_DIR/.build/node-sdk27-$(node -p process.version)"

# A usable host: executable, validly signed, and actually stamped SDK 27.
is_usable() {
  [[ -x "$1" ]] &&
    codesign --verify "$1" 2>/dev/null &&
    otool -l "$1" | awk '/LC_BUILD_VERSION/ {f=1} f && /sdk/ {print $2; exit}' | grep -qx '27.0'
}

if ! is_usable "$OUT"; then
  mkdir -p "$(dirname "$OUT")"
  # Built and signed under a temporary name, then moved into place, so an
  # interrupted or failed run never leaves a half-made host that gets reused.
  TMP="$(mktemp "$OUT.XXXXXX")"
  trap 'rm -f "$TMP"' EXIT
  MINOS="$(otool -l "$NODE" | awk '/LC_BUILD_VERSION/ {f=1} f && /minos/ {print $2; exit}')"
  xcrun vtool -set-build-version macos "${MINOS:-13.5}" 27.0 -replace -output "$TMP" "$NODE" 2>/dev/null
  # vtool invalidates the signature; an ad-hoc one lets it run locally.
  codesign -f -s - "$TMP" 2>/dev/null
  if ! is_usable "$TMP"; then
    echo "error: could not make an SDK 27 copy of $NODE" >&2
    exit 1
  fi
  mv -f "$TMP" "$OUT"
fi

echo "$OUT"
