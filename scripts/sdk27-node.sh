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

if [[ ! -x "$OUT" ]]; then
  mkdir -p "$(dirname "$OUT")"
  MINOS="$(otool -l "$NODE" | awk '/LC_BUILD_VERSION/ {f=1} f && /minos/ {print $2; exit}')"
  xcrun vtool -set-build-version macos "${MINOS:-13.5}" 27.0 -replace -output "$OUT" "$NODE" 2>/dev/null
  # vtool invalidates the signature; an ad-hoc one lets it run locally.
  codesign -f -s - "$OUT" 2>/dev/null
fi

echo "$OUT"
