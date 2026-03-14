#!/bin/bash
# Builds the Foundation Models C dylib from Apple's python-apple-fm-sdk repo.
# Requires: macOS 26.0+, Xcode 26.0+, Swift toolchain in PATH
#
# Usage:
#   bash scripts/build-native.sh [/path/to/foundation-models-c]
#
# If no path is given, clones apple/python-apple-fm-sdk from GitHub.

set -euo pipefail
# Ignore SIGPIPE (exit 141) from VS Code task runner piping
trap '' PIPE

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
NATIVE_DIR="$PACKAGE_DIR/native"
LOG_FILE="$PACKAGE_DIR/build-native.log"

log() { echo "$*" | tee -a "$LOG_FILE"; }

log "=== tsfm native build ==="
log "Log: $LOG_FILE"
> "$LOG_FILE"  # truncate

# --- Skip if already built ---

if [[ -f "$NATIVE_DIR/libFoundationModels.dylib" ]]; then
  log "Native dylib already present, skipping build. Delete native/libFoundationModels.dylib to force rebuild."
  exit 0
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

XCODE_OUTPUT="$(xcodebuild -version 2>/dev/null || true)"
XCODE_VERSION="$(echo "$XCODE_OUTPUT" | grep -m1 -oE '[0-9]+\.[0-9]+')"
XCODE_MAJOR="$(echo "$XCODE_VERSION" | cut -d. -f1)"
if [[ "$XCODE_MAJOR" -lt 26 ]]; then
  log "error: Xcode 26.0+ required (found $XCODE_VERSION)."
  exit 1
fi
log "Xcode $XCODE_VERSION ✓"

# --- Prefer Xcode beta if installed (enables back-deployed 26.4 APIs) ---

XCODE_BETA="/Applications/Xcode-beta.app"
if [[ -d "$XCODE_BETA" ]]; then
  export DEVELOPER_DIR="$XCODE_BETA/Contents/Developer"
  log "Using Xcode beta (for back-deployed APIs)"
fi

# --- Locate or clone foundation-models-c ---

if [[ -n "${1:-}" ]]; then
  FM_C_DIR="$1"
  if [[ ! -d "$FM_C_DIR" ]]; then
    log "error: Could not find foundation-models-c at $FM_C_DIR"
    exit 1
  fi
  log "SDK source: $FM_C_DIR"
else
  CLONE_DIR="$PACKAGE_DIR/.build/python-apple-fm-sdk"
  if [[ ! -d "$CLONE_DIR" ]]; then
    log "Cloning apple/python-apple-fm-sdk..."
    git clone --depth 1 https://github.com/apple/python-apple-fm-sdk "$CLONE_DIR" >> "$LOG_FILE" 2>&1
  fi
  FM_C_DIR="$CLONE_DIR/foundation-models-c"
  log "SDK source: $FM_C_DIR"
fi

# --- Copy tsfm extensions into the Apple source tree ---

EXTENSIONS_DIR="$PACKAGE_DIR/native/extensions"
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

log ""
log "Artifacts in $NATIVE_DIR:"
ls -lh "$NATIVE_DIR" | tee -a "$LOG_FILE"

log ""
log "Done."
