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
# The real binary: @loader_path in its rpaths is relative to where it lives,
# not to a symlink such as Homebrew's /opt/homebrew/bin/node.
NODE="$(realpath "$(command -v node)")"
# Keyed by node version, so upgrading node produces a fresh copy.
OUT="$PACKAGE_DIR/.build/node-sdk27-$(node -p process.version)"

# A usable host: executable, validly signed, stamped SDK 27, and able to run
# (a copy that can't find its libraries would fail every test instead).
is_usable() {
  [[ -x "$1" ]] &&
    codesign --verify "$1" 2>/dev/null &&
    otool -l "$1" | awk '/LC_BUILD_VERSION/ {f=1} f && /sdk/ {print $2; exit}' | grep -qx '27.0' &&
    ("$1" -e 0) >/dev/null 2>&1
}

if ! is_usable "$OUT"; then
  mkdir -p "$(dirname "$OUT")"
  # Built and signed under a temporary name, then moved into place, so an
  # interrupted or failed run never leaves a half-made host that gets reused.
  TMP="$(mktemp "$OUT.XXXXXX")"
  trap 'rm -f "$TMP"' EXIT
  MINOS="$(otool -l "$NODE" | awk '/LC_BUILD_VERSION/ {f=1} f && /minos/ {print $2; exit}')"
  xcrun vtool -set-build-version macos "${MINOS:-13.5}" 27.0 -replace -output "$TMP" "$NODE" 2>/dev/null
  # Some builds (Homebrew's) load libnode through an rpath relative to the
  # binary, such as @loader_path/../lib, which the copy in .build/ would miss.
  # Add each one as an absolute path from the original's location.
  while read -r rpath; do
    case "$rpath" in
      @loader_path | @executable_path) rpath="$(dirname "$NODE")" ;;
      @loader_path/* | @executable_path/*) rpath="$(dirname "$NODE")/${rpath#*/}" ;;
    esac
    xcrun install_name_tool -add_rpath "$rpath" "$TMP" 2>/dev/null || true
  done < <(otool -l "$NODE" | awk '/LC_RPATH/ {f=1} f && $1 == "path" {print $2; f=0}')
  # vtool and install_name_tool invalidate the signature; an ad-hoc one lets it run locally.
  codesign -f -s - "$TMP" 2>/dev/null
  if ! is_usable "$TMP"; then
    echo "error: could not make an SDK 27 copy of $NODE" >&2
    exit 1
  fi
  mv -f "$TMP" "$OUT"
fi

echo "$OUT"
