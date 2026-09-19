#!/usr/bin/env bash
# Verifies native/libFoundationModels.dylib was built for tsfm 1.x:
# a macOS 27.0 deployment target, with the macOS 27 APIs compiled in.
#
#   bash scripts/verify-native.sh

set -euo pipefail

DYLIB="$(cd "$(dirname "$0")/.." && pwd)/native/libFoundationModels.dylib"

[[ -f "$DYLIB" ]] || { echo "error: $DYLIB not found. Run npm run build."; exit 1; }

file "$DYLIB"

MINOS="$(otool -l "$DYLIB" | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { print $2; exit }')"
if [[ "$MINOS" != "27.0" ]]; then
  echo "error: deployment target is macOS ${MINOS:-unknown}, expected 27.0."
  exit 1
fi
echo "deployment target: macOS $MINOS ✓"

# Attachment and LanguageModelError are macOS 27 APIs the bridge uses directly.
# Collected once: grep -q in a pipeline would SIGPIPE nm and trip pipefail.
IMPORTS="$(nm -m "$DYLIB" | grep '(undefined)' | grep 'from FoundationModels' || true)"
for api in Attachment LanguageModelError; do
  if ! grep -q "$api" <<<"$IMPORTS"; then
    echo "error: $api is not referenced; the bridge wasn't built against the macOS 27 SDK."
    exit 1
  fi
  echo "macOS 27 API $api: linked ✓"
done
