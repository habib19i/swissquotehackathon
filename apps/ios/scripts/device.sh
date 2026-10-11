#!/bin/sh
# Builds the app for the iPhone connected to this Mac, installs it and starts it against the tunnel.
#   scripts/device.sh TEAM_ID https://….trycloudflare.com
# TEAM_ID: your Apple development team (Xcode > Settings > Accounts). The wallet core must be built first:
#   pnpm --filter @sqw/ios-core build
set -e
cd "$(dirname "$0")/.."
TEAM="$1"
SERVER="$2"
[ -n "$TEAM" ] && [ -n "$SERVER" ] || { echo "usage: $0 TEAM_ID https://….trycloudflare.com"; exit 1; }

# The iPhone's UDID: building for it registers it with the team (a free account needs that for its profile).
DEVICE=$(xcrun devicectl list devices 2>/dev/null | awk '/connected/ && !/simulated/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-/) {print $i; exit}}')
[ -n "$DEVICE" ] || { echo "No iPhone connected (cable, Trust this computer, Developer Mode)."; exit 1; }

# WalletConnect's project ID (public by design) comes from the root .env, as for the web app.
REOWN=$(grep -E '^NEXT_PUBLIC_REOWN_PROJECT_ID=' ../../.env 2>/dev/null | cut -d= -f2-)
[ -n "$REOWN" ] || echo "Note: NEXT_PUBLIC_REOWN_PROJECT_ID is empty in .env, so WalletConnect stays off."

xcodebuild -project SwissquoteWallet.xcodeproj -scheme SwissquoteWallet -configuration Debug \
  -destination "id=$DEVICE" -derivedDataPath build/DerivedData -allowProvisioningUpdates \
  DEVELOPMENT_TEAM="$TEAM" PRODUCT_BUNDLE_IDENTIFIER="ch.swissquote.wallet.prototype.$TEAM" \
  SQW_SERVER_URL="$SERVER" SQW_REOWN_PROJECT_ID="$REOWN" build
APP=build/DerivedData/Build/Products/Debug-iphoneos/SwissquoteWallet.app
xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing \
  "ch.swissquote.wallet.prototype.$TEAM" -- -SQWServerURL "$SERVER"
