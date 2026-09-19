#!/usr/bin/env bash
# Verifies native/libFoundationModels.dylib still loads on macOS 26.
#
#   bash scripts/verify-native.sh               # deployment target + weak linking
#   bash scripts/verify-native.sh --attachments # also require prompt attachments
#
# The dylib must keep a macOS 26.0 deployment target, and every symbol that
# FoundationModels only exports on macOS 27 must be weak-linked. A strong
# reference to one makes dyld refuse to load the library on macOS 26.

set -euo pipefail

DYLIB="$(cd "$(dirname "$0")/.." && pwd)/native/libFoundationModels.dylib"
REQUIRE_ATTACHMENTS=false
[[ "${1:-}" == "--attachments" ]] && REQUIRE_ATTACHMENTS=true

[[ -f "$DYLIB" ]] || { echo "error: $DYLIB not found. Run npm run build."; exit 1; }

file "$DYLIB"

MINOS="$(otool -l "$DYLIB" | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { print $2; exit }')"
if [[ "$MINOS" != "26.0" ]]; then
  echo "error: deployment target is macOS ${MINOS:-unknown}, expected 26.0."
  exit 1
fi
echo "deployment target: macOS $MINOS ✓"

# Attachment is the macOS 27 API the bridge uses; FM_HAS_MACOS_27_SDK pulls it in.
ATTACHMENT_REFS="$(nm -m "$DYLIB" | grep '(undefined)' | grep 'from FoundationModels' | grep -E 'Attachment' || true)"
if [[ -z "$ATTACHMENT_REFS" ]]; then
  if $REQUIRE_ATTACHMENTS; then
    echo "error: prompt attachments are not compiled in. Build with the macOS 27 SDK."
    exit 1
  fi
  echo "prompt attachments: not compiled in (macOS 26 SDK build)"
  exit 0
fi

STRONG="$(echo "$ATTACHMENT_REFS" | grep -v 'weak external' || true)"
if [[ -n "$STRONG" ]]; then
  echo "error: macOS 27 symbols are strongly linked, so the dylib will not load on macOS 26:"
  echo "$STRONG"
  exit 1
fi
echo "prompt attachments: compiled in, $(echo "$ATTACHMENT_REFS" | wc -l | tr -d ' ') macOS 27 symbols weak-linked ✓"
