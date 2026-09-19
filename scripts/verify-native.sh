#!/usr/bin/env bash
# Verifies native/libFoundationModels.dylib was built for tsfm 1.x: a macOS 26.0
# deployment target, with the macOS 27 APIs compiled in but weak-linked, so the
# library loads on macOS 26 and those features fail there with a typed error.
#
#   bash scripts/verify-native.sh

set -euo pipefail

DYLIB="$(cd "$(dirname "$0")/.." && pwd)/native/libFoundationModels.dylib"

[[ -f "$DYLIB" ]] || { echo "error: $DYLIB not found. Run npm run build."; exit 1; }

file "$DYLIB"

MINOS="$(otool -l "$DYLIB" | awk '/LC_BUILD_VERSION/ { found = 1 } found && $1 == "minos" { print $2; exit }')"
if [[ "$MINOS" != "26.0" ]]; then
  echo "error: deployment target is macOS ${MINOS:-unknown}, expected 26.0."
  exit 1
fi
echo "deployment target: macOS $MINOS ✓"

# These macOS 27 APIs must be referenced (built against the macOS 27 SDK) and
# weak (a strong reference fails to load on macOS 26 before any #available runs).
# Collected once: grep -q in a pipeline would SIGPIPE nm and trip pipefail.
IMPORTS="$(nm -m "$DYLIB" | grep '(undefined)' | grep 'from FoundationModels' || true)"
for api in Attachment LanguageModelError PrivateCloudComputeLanguageModel ContextOptions LanguageModelCapabilities; do
  MATCHES="$(grep "$api" <<<"$IMPORTS" || true)"
  if [[ -z "$MATCHES" ]]; then
    echo "error: $api is not referenced; the bridge wasn't built against the macOS 27 SDK."
    exit 1
  fi
  STRONG="$(grep -v 'weak external' <<<"$MATCHES" || true)"
  if [[ -n "$STRONG" ]]; then
    echo "error: macOS 27 API $api is strongly linked, so the library won't load on macOS 26:"
    echo "$STRONG" | head -5
    exit 1
  fi
  echo "macOS 27 API $api: weak-linked ✓"
done
