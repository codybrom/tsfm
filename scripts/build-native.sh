#!/bin/bash
# Builds the Foundation Models C dylib from tsfm's Swift-to-C bridge in
# native/bridge (a fork of Apple's foundation-models-c, see
# native/bridge/UPSTREAM.md), plus native/extensions.
# Requires: macOS 26.0+, Xcode 26.4+, Swift toolchain in PATH
#
# Usage:
#   bash scripts/build-native.sh [/path/to/bridge]
#
# A path overrides native/bridge, e.g. to try an upstream foundation-models-c checkout.

set -euo pipefail
# Ignore SIGPIPE (exit 141) from VS Code task runner piping
trap '' PIPE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$PACKAGE_DIR/native"
LOG_FILE="$PACKAGE_DIR/build-native.log"

# The bridge. src/bindings.ts is written against exactly this source:
# koffi binds by symbol name and can't see a changed parameter type, so any edit
# to a C signature here needs the matching change in src/bindings.ts.
BRIDGE_DIR="$NATIVE_DIR/bridge"
# Built from a copy so native/bridge never holds build output or extensions.
STAGING_DIR="$PACKAGE_DIR/.build/bridge"

log() { echo "$*" | tee -a "$LOG_FILE"; }

log "=== tsfm native build ==="
log "Log: $LOG_FILE"
> "$LOG_FILE"  # truncate

# --- Select the toolchain ---
#
# A beta is preferred when present: it is how you get an SDK newer than the
# released Xcode, which is what prompt attachments need (macOS 27 SDK). This
# has to happen before the SDK check and the version check below, or they
# validate the selected Xcode while swift build uses the beta.

XCODE_BETA="/Applications/Xcode-beta.app"
if [[ -d "$XCODE_BETA" ]]; then
  export DEVELOPER_DIR="$XCODE_BETA/Contents/Developer"
  log "Preferring Xcode beta at $XCODE_BETA"
fi

# Prompt attachments compile only when FM_HAS_MACOS_27_SDK is defined, which
# upstream's build_backend.py sets for a macOS 27+ SDK. The deployment target
# stays at macOS 26 (Package.swift), and the bridge gates attachments behind
# #available(macOS 27), so one dylib loads on 26 and supports attachments on 27.
SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)"
SDK_MAJOR="$(echo "$SDK_VERSION" | cut -d. -f1)"
HAS_MACOS_27_SDK=false
[[ "$SDK_MAJOR" =~ ^[0-9]+$ && "$SDK_MAJOR" -ge 27 ]] && HAS_MACOS_27_SDK=true

SOURCE_DIR="${1:-$BRIDGE_DIR}"
EXTENSIONS_DIR="$NATIVE_DIR/extensions"

# --- Skip if already built from the same inputs ---
#
# The bridge source lives in the repo and changes, so "a dylib exists" isn't
# enough: a stale one would be packaged by prepublishOnly and no longer match
# src/bindings.ts. The build records a fingerprint of everything it was built
# from, and later runs skip only when that fingerprint still matches. The SDK
# version is part of it, so switching to the macOS 27 SDK (prompt attachments)
# also triggers a rebuild.

DYLIB="$NATIVE_DIR/libFoundationModels.dylib"
HEADER="$NATIVE_DIR/FoundationModels.h"
STAMP="$NATIVE_DIR/.build-inputs.sha256"

hash_tree() {
  (cd "$1" && find . -path ./.build -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256)
}

build_fingerprint() {
  {
    echo "sdk=$SDK_VERSION attachments=$HAS_MACOS_27_SDK developer_dir=${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null || true)}"
    swift --version 2>/dev/null | sed -n 1p || true
    shasum -a 256 < "$SCRIPT_DIR/build-native.sh"
    [[ -d "$SOURCE_DIR" ]] && hash_tree "$SOURCE_DIR"
    [[ -d "$EXTENSIONS_DIR" ]] && hash_tree "$EXTENSIONS_DIR"
  } | shasum -a 256 | cut -d' ' -f1
}

INPUTS_FINGERPRINT="$(build_fingerprint)"
if [[ -f "$DYLIB" && -f "$HEADER" && -f "$STAMP" && "$(cat "$STAMP")" == "$INPUTS_FINGERPRINT" ]]; then
  log "Native dylib is up to date with its sources, skipping build."
  exit 0
fi
if [[ -f "$DYLIB" ]]; then
  # Left in place until the copy step overwrites it, so a failed rebuild
  # still leaves a loadable library.
  log "Native sources, extensions or toolchain changed since the last build. Rebuilding."
fi

# --- Check prerequisites ---

if [[ "$(uname)" != "Darwin" ]]; then
  log "error: Apple Foundation Models only runs on macOS."
  exit 1
fi

MACOS_VERSION="$(sw_vers -productVersion)"
MACOS_MAJOR="$(echo "$MACOS_VERSION" | cut -d. -f1)"
if [[ "$MACOS_MAJOR" -lt 26 ]]; then
  log "error: macOS 26.0+ required (found $MACOS_VERSION)."
  exit 1
fi
log "macOS $MACOS_VERSION ✓"

if ! command -v swift &>/dev/null; then
  log "error: 'swift' not found. Install Xcode 26+."
  exit 1
fi

# --- Validate the selected toolchain ---

# Reads whatever DEVELOPER_DIR points at (see toolchain selection above).
XCODE_OUTPUT="$(xcodebuild -version 2>/dev/null || true)"
XCODE_VERSION="$(echo "$XCODE_OUTPUT" | grep -m1 -oE '[0-9]+\.[0-9]+')"
XCODE_MAJOR="$(echo "$XCODE_VERSION" | cut -d. -f1)"
XCODE_MINOR="$(echo "$XCODE_VERSION" | cut -d. -f2)"
# The bridge reads SystemLanguageModel.contextSize, whose declaration first
# appears in the Xcode 26.4 SDK. Earlier Xcode 26.x passes a major-only check
# and then fails mid-compile on a missing member.
if [[ "$XCODE_MAJOR" -lt 26 || ( "$XCODE_MAJOR" -eq 26 && "$XCODE_MINOR" -lt 4 ) ]]; then
  log "error: Xcode 26.4+ required (found $XCODE_VERSION)."
  if [[ -n "${DEVELOPER_DIR:-}" ]]; then
    log "       Selected toolchain: $DEVELOPER_DIR"
    log "       Remove or update that beta, or unset DEVELOPER_DIR, to use the released Xcode."
  fi
  log "       The C bridge needs the 26.4 SDK to see SystemLanguageModel.contextSize."
  exit 1
fi
log "Xcode $XCODE_VERSION ✓"

# --- Stage the bridge source ---

if [[ ! -f "$SOURCE_DIR/Package.swift" ]]; then
  log "error: Could not find the bridge package (Package.swift) at $SOURCE_DIR"
  exit 1
fi
log "Bridge source: $SOURCE_DIR"

# A fresh copy every time, so extensions from a previous run can't linger.
# The staging dir's own .build (SwiftPM cache) is kept for incremental builds.
mkdir -p "$STAGING_DIR"
rsync -a --delete --exclude .build "$SOURCE_DIR/" "$STAGING_DIR/"
FM_C_DIR="$STAGING_DIR"

# --- Add tsfm extensions to the staged source ---

BINDINGS_SRC="$FM_C_DIR/Sources/FoundationModelsCBindings"
if [[ -d "$EXTENSIONS_DIR" ]]; then
  for f in "$EXTENSIONS_DIR"/*.swift; do
    [[ -f "$f" ]] && cp -f "$f" "$BINDINGS_SRC/"
    log "Injected: $(basename "$f")"
  done
fi

# --- Build (redirect verbose Swift output to log file) ---

SWIFT_ARGS=()
if $HAS_MACOS_27_SDK; then
  SWIFT_ARGS+=(-Xswiftc -DFM_HAS_MACOS_27_SDK)
  log "macOS SDK $SDK_VERSION: prompt attachments enabled"
else
  log "macOS SDK ${SDK_VERSION:-unknown}: prompt attachments disabled (needs the macOS 27 SDK)"
fi

log "Building Foundation Models C bindings (this takes ~1-2 min)..."
swift build -c release --package-path "$FM_C_DIR" ${SWIFT_ARGS[@]+"${SWIFT_ARGS[@]}"} >> "$LOG_FILE" 2>&1
log "Build complete."

BUILD_DIR="$(swift build -c release --package-path "$FM_C_DIR" --show-bin-path 2>>"$LOG_FILE")"

# --- Copy artifacts ---

mkdir -p "$NATIVE_DIR"

# Copy the dylib directly (NOT recursively — the .dSYM bundle also contains a file
# named libFoundationModels.dylib and would overwrite the real one)
cp -f "$BUILD_DIR/libFoundationModels.dylib" "$NATIVE_DIR/"
log "Copied: libFoundationModels.dylib"

cp -f "$FM_C_DIR/Sources/FoundationModelsCBindings/include/FoundationModels.h" "$NATIVE_DIR/"
# Append tsfm extension headers
for f in "$EXTENSIONS_DIR"/*.h; do
  if [[ -f "$f" ]]; then
    # Insert before the final #endif
    sed -i '' '/#endif/d' "$NATIVE_DIR/FoundationModels.h"
    cat "$f" >> "$NATIVE_DIR/FoundationModels.h"
    printf '\n#endif /* FoundationModels_h */\n' >> "$NATIVE_DIR/FoundationModels.h"
    log "Merged header: $(basename "$f")"
  fi
done
log "Copied: FoundationModels.h"

# Recorded last, so a build that fails partway leaves no matching fingerprint
# and the next run rebuilds.
echo "$INPUTS_FINGERPRINT" > "$STAMP"

log ""
log "Artifacts in $NATIVE_DIR:"
ls -lh "$NATIVE_DIR" | tee -a "$LOG_FILE"

log ""
log "Done."
