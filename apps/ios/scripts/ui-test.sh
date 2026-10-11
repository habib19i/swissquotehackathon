#!/bin/sh
# Runs the UI tests in the Simulator with Face ID enrolled and every Face ID prompt answered with a
# matching face. Needs `pnpm dev` running and the core built (pnpm --filter @sqw/ios-core build).
#   scripts/ui-test.sh ["iPhone 17"] [-only-testing:SwissquoteWalletUITests/WalletUITests/testName]
set -e
cd "$(dirname "$0")/.."
SIM="${1:-iPhone 17}"
[ $# -gt 0 ] && shift
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b >/dev/null
xcrun simctl spawn "$SIM" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
xcrun simctl spawn "$SIM" notifyutil -p com.apple.BiometricKit.enrollmentChanged
( while true; do sleep 1; xcrun simctl spawn "$SIM" notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1; done ) &
FACE=$!
trap 'kill $FACE 2>/dev/null' EXIT
xcodebuild test -project SwissquoteWallet.xcodeproj -scheme SwissquoteWallet \
  -destination "platform=iOS Simulator,name=$SIM" -derivedDataPath build/DerivedData \
  -resultBundlePath "build/UITests-$(date +%Y%m%d-%H%M%S).xcresult" "$@"
