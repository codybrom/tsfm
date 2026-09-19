#!/bin/bash
# Builds the Foundation Models C dylib from Apple's python-apple-fm-sdk repo.
# Requires: macOS 26.0+, Xcode 26.4+, Swift toolchain in PATH
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

# Upstream C bridge revision this SDK is built and tested against.
#
# Pinned deliberately: koffi binds by symbol name and cannot see a changed
# parameter type, so an unpinned clone yields a dylib that links but misbehaves
# at runtime. src/bindings.ts is written against exactly this revision.
#
# To try a newer revision: FM_SDK_REF=<sha> bash scripts/build-native.sh
# Moving the pin means updating src/bindings.ts and native/extensions to match.
FM_SDK_REF="${FM_SDK_REF:-e868e60811aa0706feb2ccb33cfe7e27626287b7}"
CLONE_DIR="$PACKAGE_DIR/.build/python-apple-fm-sdk"

log() { echo "$*" | tee -a "$LOG_FILE"; }

log "=== tsfm native build ==="
log "Log: $LOG_FILE"
> "$LOG_FILE"  # truncate

# --- Warn if the checkout has drifted from the pin ---
#
# Deliberately ahead of the skip-if-built shortcut below: a stale dylib next to
# a drifted checkout would otherwise skip the build and the pin check together,
# leaving no sign that the artifact and the source no longer agree. Reads local
# HEAD only, so it costs nothing.

if [[ -d "$CLONE_DIR" ]]; then
  CLONE_REF="$(git -C "$CLONE_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"
  if [[ "$CLONE_REF" != "$FM_SDK_REF" ]]; then
    log "warning: $CLONE_DIR is at ${CLONE_REF:0:8}, pinned revision is ${FM_SDK_REF:0:8}."
    log "         Delete native/libFoundationModels.dylib to rebuild at the pin."
  fi
fi

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

# --- Skip if already built ---
#
# Unless the dylib predates the macOS 27 SDK: one built against the 26 SDK has
# no attachment support, and skipping would keep it after switching to Xcode 27.

DYLIB="$NATIVE_DIR/libFoundationModels.dylib"
if [[ -f "$DYLIB" ]]; then
  if $HAS_MACOS_27_SDK && ! nm -m "$DYLIB" 2>/dev/null | grep 'Attachment.*from FoundationModels' >/dev/null; then
    # Left in place until the copy step overwrites it, so a failed rebuild
    # still leaves a loadable library.
    log "Native dylib was built without prompt attachments, but the macOS $SDK_VERSION SDK is active. Rebuilding."
  else
    log "Native dylib already present, skipping build. Delete native/libFoundationModels.dylib to force rebuild."
    exit 0
  fi
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

# --- Locate or clone foundation-models-c ---

if [[ -n "${1:-}" ]]; then
  FM_C_DIR="$1"
  if [[ ! -d "$FM_C_DIR" ]]; then
    log "error: Could not find foundation-models-c at $FM_C_DIR"
    exit 1
  fi
  log "SDK source: $FM_C_DIR"
else
  if [[ ! -d "$CLONE_DIR" ]]; then
    log "Cloning apple/python-apple-fm-sdk at ${FM_SDK_REF:0:8}..."
    git init -q "$CLONE_DIR" >> "$LOG_FILE" 2>&1
    git -C "$CLONE_DIR" remote add origin https://github.com/apple/python-apple-fm-sdk >> "$LOG_FILE" 2>&1
    git -C "$CLONE_DIR" fetch -q --depth 1 origin "$FM_SDK_REF" >> "$LOG_FILE" 2>&1
    git -C "$CLONE_DIR" checkout -q FETCH_HEAD >> "$LOG_FILE" 2>&1
  fi

  # An existing checkout is reused, so confirm it is the pinned revision rather
  # than whatever a previous run happened to leave behind.
  CURRENT_REF="$(git -C "$CLONE_DIR" rev-parse HEAD 2>/dev/null || echo "unknown")"
  if [[ "$CURRENT_REF" != "$FM_SDK_REF" ]]; then
    log "Existing checkout is at ${CURRENT_REF:0:8}, expected ${FM_SDK_REF:0:8} — fetching pin..."
    if ! git -C "$CLONE_DIR" fetch -q --depth 1 origin "$FM_SDK_REF" >> "$LOG_FILE" 2>&1 \
      || ! git -C "$CLONE_DIR" checkout -q FETCH_HEAD >> "$LOG_FILE" 2>&1; then
      log "error: could not check out $FM_SDK_REF in $CLONE_DIR."
      log "       Remove the directory and re-run, or set FM_SDK_REF to a revision you have."
      exit 1
    fi
    CURRENT_REF="$(git -C "$CLONE_DIR" rev-parse HEAD)"
  fi

  FM_C_DIR="$CLONE_DIR/foundation-models-c"
  log "SDK source: $FM_C_DIR @ ${CURRENT_REF:0:8}"
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

log ""
log "Artifacts in $NATIVE_DIR:"
ls -lh "$NATIVE_DIR" | tee -a "$LOG_FILE"

log ""
log "Done."
