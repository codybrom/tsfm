#!/bin/bash
# Builds the Foundation Models C dylib from tsfm's Swift-to-C bridge in
# native/bridge (a fork of Apple's foundation-models-c, see
# native/bridge/UPSTREAM.md), plus native/extensions.
# Requires: Xcode 27+ (macOS 27 SDK, Swift 6.4). The dylib runs on macOS 26+.
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

# The bridge deploys to macOS 26 (Package.swift) and uses macOS 27 APIs behind
# #available, so it needs the macOS 27 SDK. Checked below, after the skip shortcut.
SDK_VERSION="$(xcrun --sdk macosx --show-sdk-version 2>/dev/null || true)"
SDK_MAJOR="$(echo "$SDK_VERSION" | cut -d. -f1)"

SOURCE_DIR="${1:-$BRIDGE_DIR}"
EXTENSIONS_DIR="$NATIVE_DIR/extensions"

# --- Skip if already built from the same inputs ---
#
# The bridge source lives in the repo and changes, so "a dylib exists" isn't
# enough: a stale one would be packaged by prepublishOnly and no longer match
# src/bindings.ts. The build records a fingerprint of everything it was built
# from, and later runs skip only when that fingerprint still matches. The SDK
# version and toolchain are part of it, so switching Xcode triggers a rebuild.

DYLIB="$NATIVE_DIR/libFoundationModels.dylib"
HEADER="$NATIVE_DIR/FoundationModels.h"
ADDON_DIR="$NATIVE_DIR/addon"
ADDON="$NATIVE_DIR/tsfm.node"
STAMP="$NATIVE_DIR/.build-inputs.sha256"

hash_tree() {
  (cd "$1" && find . -path ./.build -prune -o -type f -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256)
}

build_fingerprint() {
  {
    echo "sdk=$SDK_VERSION developer_dir=${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null || true)}"
    swift --version 2>/dev/null | sed -n 1p || true
    shasum -a 256 < "$SCRIPT_DIR/build-native.sh"
    [[ -d "$SOURCE_DIR" ]] && hash_tree "$SOURCE_DIR"
    [[ -d "$EXTENSIONS_DIR" ]] && hash_tree "$EXTENSIONS_DIR"
    [[ -d "$ADDON_DIR" ]] && hash_tree "$ADDON_DIR"
  } | shasum -a 256 | cut -d' ' -f1
}

INPUTS_FINGERPRINT="$(build_fingerprint)"
if [[ -f "$DYLIB" && -f "$HEADER" && -f "$ADDON" && -f "$STAMP" && "$(cat "$STAMP")" == "$INPUTS_FINGERPRINT" ]]; then
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

# Building needs the macOS 27 SDK (checked below); the dylib runs on macOS 26 and 27.
log "Build host: macOS $(sw_vers -productVersion)"

if ! command -v swift &>/dev/null; then
  log "error: 'swift' not found. Install Xcode 27+."
  exit 1
fi

# --- Validate the selected toolchain ---

XCODE_OUTPUT="$(xcodebuild -version 2>/dev/null || true)"
XCODE_VERSION="$(echo "$XCODE_OUTPUT" | grep -m1 -oE '[0-9]+\.[0-9]+')"
XCODE_MAJOR="$(echo "$XCODE_VERSION" | cut -d. -f1)"
if [[ ! "$XCODE_MAJOR" =~ ^[0-9]+$ || "$XCODE_MAJOR" -lt 27 ]]; then
  log "error: Xcode 27+ required (found ${XCODE_VERSION:-none})."
  log "       The bridge uses macOS 27 APIs and Package.swift needs swift-tools-version 6.4."
  exit 1
fi
if [[ ! "$SDK_MAJOR" =~ ^[0-9]+$ || "$SDK_MAJOR" -lt 27 ]]; then
  log "error: macOS 27 SDK required (found ${SDK_VERSION:-none}). Select Xcode 27 with xcode-select."
  exit 1
fi
log "Xcode $XCODE_VERSION, macOS SDK $SDK_VERSION ✓"

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

log "Building Foundation Models C bindings (this takes ~1-2 min)..."
swift build -c release --package-path "$FM_C_DIR" >> "$LOG_FILE" 2>&1
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

# --- Node-API addon ---
#
# tsfm.node is how JavaScript calls the bridge (see native/addon/tsfm_addon.c).
# Node-API is ABI-stable, so one arm64 build serves every Node version; it
# needs Node's headers only here, at build time. It deploys to macOS 26 like
# the dylib, and finds the dylib next to itself at runtime.
NODE_INCLUDE="$(node -p 'require("path").resolve(require("fs").realpathSync(process.execPath), "../../include/node")')"
if [[ ! -f "$NODE_INCLUDE/node_api.h" ]]; then
  log "error: node_api.h not found in $NODE_INCLUDE. Install Node.js from nodejs.org, nvm or Homebrew."
  exit 1
fi
# For the editor's clang (clangd, SourceKit-LSP). Gitignored: this machine's paths.
printf '%s\n' -std=c11 "-I$NODE_INCLUDE" "-I$NATIVE_DIR" > "$ADDON_DIR/compile_flags.txt"
log "Building the Node-API addon..."
xcrun clang -std=c11 -O2 -Wall -Wextra -Werror \
  -mmacosx-version-min=26.0 -arch arm64 \
  -bundle -undefined dynamic_lookup \
  -I "$NODE_INCLUDE" -I "$NATIVE_DIR" \
  "$ADDON_DIR/tsfm_addon.c" \
  -L "$NATIVE_DIR" -lFoundationModels -Wl,-rpath,@loader_path \
  -o "$ADDON" >> "$LOG_FILE" 2>&1 || {
  log "error: the addon failed to build; see $LOG_FILE."
  exit 1
}
log "Built: tsfm.node"

# Recorded last, so a build that fails partway leaves no matching fingerprint
# and the next run rebuilds.
echo "$INPUTS_FINGERPRINT" > "$STAMP"

log ""
log "Artifacts in $NATIVE_DIR:"
ls -lh "$NATIVE_DIR" | tee -a "$LOG_FILE"

log ""
log "Done."
