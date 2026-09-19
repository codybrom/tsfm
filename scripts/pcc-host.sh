#!/bin/bash
# Builds a copy of node, signed with the Private Cloud Compute entitlement, for
# running tsfm's PCC tests locally. Prints the path to its node binary.
#
# PCC needs the managed entitlement com.apple.developer.private-cloud-compute on
# the host executable, granted through a provisioning profile. Plain node can't
# carry it, so this wraps a copy of node in a minimal app bundle that uses your
# profile's App ID.
#
# Needs:
#   TSFM_PCC_PROFILE  path to a macOS development provisioning profile whose App ID
#                     has the Private Cloud Compute capability (e.g. the
#                     embedded.provisionprofile of an app you built with it)
#   TSFM_PCC_IDENTITY optional codesign identity; default: the first
#                     "Apple Development" identity in your keychain
#
# Usage: TSFM_PCC_PROFILE=… npm run test:integration:pcc

set -euo pipefail

PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${TSFM_PCC_PROFILE:?set TSFM_PCC_PROFILE to a provisioning profile with the PCC capability}"
[[ -f "$PROFILE" ]] || { echo "error: $PROFILE not found" >&2; exit 1; }

WORK="$PACKAGE_DIR/.build/pcc-host"
APP="$WORK/TsfmPCCHost.app"
mkdir -p "$WORK"
PLIST="$WORK/profile.plist"
security cms -D -i "$PROFILE" > "$PLIST"

value() { /usr/libexec/PlistBuddy -c "Print :$1" "$PLIST" 2>/dev/null; }
APP_ID="$(value 'Entitlements:com.apple.application-identifier')"
TEAM_ID="$(value 'Entitlements:com.apple.developer.team-identifier')"
if [[ "$(value 'Entitlements:com.apple.developer.private-cloud-compute')" != "true" ]]; then
  echo "error: the profile doesn't grant com.apple.developer.private-cloud-compute" >&2
  exit 1
fi
BUNDLE_ID="${APP_ID#"$TEAM_ID".}"

IDENTITY="${TSFM_PCC_IDENTITY:-$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)}"
[[ -n "$IDENTITY" ]] || { echo "error: no Apple Development signing identity found" >&2; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$(node -p process.execPath)" "$APP/Contents/MacOS/node"
cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleExecutable</key><string>node</string>
  <key>CFBundleName</key><string>TsfmPCCHost</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
</dict>
</plist>
EOF
cat > "$WORK/entitlements.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.application-identifier</key><string>$APP_ID</string>
  <key>com.apple.developer.team-identifier</key><string>$TEAM_ID</string>
  <key>com.apple.developer.private-cloud-compute</key><true/>
</dict>
</plist>
EOF
codesign -f -s "$IDENTITY" --entitlements "$WORK/entitlements.plist" "$APP" >/dev/null 2>&1 \
  || { echo "error: codesign failed with identity '$IDENTITY'" >&2; exit 1; }

echo "$APP/Contents/MacOS/node"
