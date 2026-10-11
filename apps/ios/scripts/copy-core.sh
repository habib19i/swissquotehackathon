#!/bin/sh
# Copies the wallet core (apps/ios-core/dist) into the app bundle as core/.
# Build it first: pnpm --filter @sqw/ios-core build
set -e
CORE="$SRCROOT/../ios-core/dist"
for f in index.html wallet-core.js dkls.wasm; do
  if [ ! -f "$CORE/$f" ]; then
    echo "error: wallet core missing ($CORE/$f). Run: pnpm --filter @sqw/ios-core build"
    exit 1
  fi
done
DEST="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/core"
mkdir -p "$DEST"
cp "$CORE/index.html" "$CORE/wallet-core.js" "$CORE/dkls.wasm" "$DEST/"
