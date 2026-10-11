# Native iOS app: plan

Status: **agreed, in progress. Step 1 (wallet core) done and tested; next: step 2 on the team Mac.** This file
is the handoff for building the iOS app on the team Mac. It records the decisions taken on 2026-10-11 and how
each part of the web app maps to the native app.

## Decisions

| Question | Decision |
|---|---|
| Where | Built and tested on the team Mac with Xcode (Simulator first, then a device). Windows cannot build iOS. |
| Crypto | **Hybrid.** SwiftUI for every screen; native Face ID, Secure Enclave, Keychain, camera, speech, WalletConnect. The audited crypto and wallet protocol code (DKLs23, bitcoinjs-lib, viem, `@sqw/*`) runs unchanged in a hidden `WKWebView` inside the app: the **wallet core**. |
| Scope | Everything, screen by screen (1-to-1 with `apps/web`). The web app stays as the demo fallback until the native app has passed the full demo script. |
| Recovery key | The recovery-key step opens a web page (`/native/recovery-key`) from the app; the passkey or security key ceremony happens there and the result comes back to the app. |
| Services | Unchanged: the co-signer and the recovery provider are the same processes. The Next.js server keeps serving `/api/assistant` (the LLM key never reaches the phone), `/api/price`, the recovery-key page and the mock e-banking page. |

Why not a pure-Swift port of the crypto: CLAUDE.md forbids writing our own cryptography, there is no Swift
build of the exact DKLs23 library, and new shares must stay compatible with the shares the services hold. A
`WKWebView` runs WebAssembly; the plain JavaScriptCore framework on iOS does not, so the core lives in a web view.

## Architecture

```mermaid
flowchart LR
  subgraph app["iOS app (Swift, SwiftUI)"]
    ui["Screens (SwiftUI)"]
    bridge["WalletCore bridge<br/>(async calls, JSON)"]
    native["Native: Face ID + Secure Enclave key,<br/>Keychain vault, storage, camera QR,<br/>speech, WalletConnect (reown-swift)"]
    subgraph wv["Hidden WKWebView"]
      core["wallet-core.js + dkls.wasm<br/>(apps/web/lib, @sqw/* packages)"]
    end
  end
  ui --> bridge --> core
  core -- "platform calls: sign, vault, storage" --> native
  core -- "sqw://svc/* (scheme handler proxies)" --> svc["Co-signer :4001<br/>Recovery provider :4002"]
  core -- "https" --> chains["mempool.space signet,<br/>Base Sepolia RPC"]
  ui -- "https" --> next["Next.js server:<br/>/api/assistant, /api/price,<br/>/native/recovery-key"]
```

- The web view loads `sqw://core/index.html` through a `WKURLSchemeHandler`. The same handler proxies
  `sqw://svc/cosigner/*` and `sqw://svc/recovery/*` to the services, as the Next.js rewrites do for the web app
  (no CORS, one place to configure the Mac's address).
- **One source of truth.** The core is bundled from the web app's own `lib/` with esbuild. Four modules are
  swapped for native-backed versions at bundle time: `passkey`, `vault`, `dkls` (wasm path) and `idb-keyval`
  (storage). The web app itself is not changed.

## Face ID (native)

- **Wallet passkey = a Secure Enclave P-256 key**, created with `SecureEnclave.P256.Signing.PrivateKey` and an
  access control of `.privateKeyUsage` + `.biometryCurrentSet`. Face ID is asked by the system at each use. A
  new face enrolled on the phone invalidates the key (the safe is then recovered like a lost phone).
- **Base payments keep working with the deployed contracts.** `RulebookAccount` uses OpenZeppelin's
  `WebAuthn.verify`, which checks the challenge, the user-present and user-verified flags and the signature, not
  the origin or the rpIdHash. The core builds a WebAuthn-format assertion (authenticatorData with UP and UV set,
  clientDataJSON with `"type":"webauthn.get"` and the challenge); the Secure Enclave signs
  `authenticatorData || SHA-256(clientDataJSON)` (CryptoKit hashes it with SHA-256); the existing
  `passkeySignature()` normalizes `s`. The `apps-check` live test already proved a non-browser P-256 key works.
- **Vault = Keychain.** Share 1 and the pocket key are stored as one Keychain item with
  `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` and `.biometryCurrentSet`: reading it requires Face ID and the
  item never leaves the device or its backups. (Web app equivalent: AES-GCM with a key from the passkey's PRF.)
- `Info.plist`: `NSFaceIDUsageDescription`.

## Recovery key (web page)

The recovery key (hardware security key by default, or a synced passkey) is registered and used only with the
recovery provider, which verifies WebAuthn with `@simplewebauthn/server` against an origin and RP ID. The core
asks the app (`recoveryKey.register` / `recoveryKey.authenticate`, with the provider's options), and the app opens
[`/native/recovery-key`](../apps/web/app/native/recovery-key/page.tsx) in an `ASWebAuthenticationSession`
(callback scheme `sqwallet`):

- request: `http://<web app>/native/recovery-key#mode=register|authenticate&options=<base64url JSON>&state=<random>`;
- answer: `sqwallet://recovery-key#state=<same>&response=<base64url JSON>`, or `#state=<same>&error=<text>`
  (`error=cancelled` when the client cancels). The app checks `state` and returns `{ response }` to the core,
  which sends it to the provider unchanged.

Constraint to settle before testing on a device: WebAuthn needs `localhost` or an https **domain** (an IP address
is not allowed as RP ID). The Simulator reaches the Mac as `localhost`, so it works there as today. On a real
iPhone the page needs an https hostname for the Mac (a tunnel), set as `RP_ID` and in `APP_ORIGINS` of the
recovery provider. **Ask before starting a public tunnel.**

## Mapping: web app to iOS

| Web (`apps/web`) | iOS (`apps/ios/SwissquoteWallet`) |
|---|---|
| `app/layout.tsx`, `components/screen.tsx`, `tab-bar.tsx` | `App/SwissquoteWalletApp.swift`, `UI/Screen.swift`, `UI/TabBar.swift` (Home, Explore, Assistant, Send, Rules) |
| `app/globals.css`, `replica/design/tokens.json`, appearance | `UI/Theme.swift` (colour tokens, light and dark, background presets, Geist font bundled) |
| `app/login` | `Screens/LoginView.swift` (Mock login) |
| `app/onboarding`, `keyholders.tsx`, `plan-choice.tsx`, `recovery-key-setup.tsx` | `Screens/Onboarding/*` |
| `app/page.tsx`, `ask-box.tsx`, `tokens.tsx` | `Screens/HomeView.swift`, `UI/AskBox.swift`, `UI/TokenIcons.swift` |
| `app/send/*` | `Screens/Send/SendView.swift`, `BitcoinConfirmView.swift`, `UsdcConfirmView.swift`, sent views |
| `app/receive` | `Screens/ReceiveView.swift` (QR with Core Image) |
| `app/rules` | `Screens/RulesView.swift` (contacts, apps, limits, pending changes with countdown, screening card) |
| `app/activity`, `app/alerts`, `alerts-feed.tsx` | `Screens/ActivityView.swift`, `AlertsView.swift` |
| `app/assistant` | `Screens/AssistantView.swift` (speech: `SFSpeechRecognizer`, still labelled Mock of Swiss-hosted speech-to-text) |
| `app/explore`, `explore/[id]`, `app-confirm.tsx` | `Screens/Explore/*` (search, app page, swap and Aave panels, confirm and done) |
| `app/explore/scan`, `connect-overlay.tsx`, `lib/walletconnect.ts` | `Screens/Explore/ConnectAppView.swift` (camera QR with AVFoundation), `WalletConnect/*` (reown-swift WalletKit) |
| `app/recover`, `app/recovery-key` | `Screens/Recovery/*` (face check Mock, countdown, recovery key via the web page) |
| `app/settings`, `app/demo`, `app/demo/attacker` | `Screens/SettingsView.swift`, `Screens/Demo/*` |
| `app/e-banking` | Stays a web page: it is the client's *other* device (Mock). |
| `lib/*.ts` (wallet layer) | Runs in the wallet core; called through `Core/WalletCore.swift` |
| `lib/passkey.ts`, `lib/vault.ts`, `idb-keyval` | Native: `Native/FaceIdKey.swift` (Secure Enclave), `Native/Vault.swift` (Keychain), `Native/Storage.swift` |

## Wallet core API

`apps/ios-core` builds `wallet-core.js` + `dkls.wasm`. It exposes one function, `window.sqwCore.call(name, args)`,
returning JSON (bigints as decimal strings). Names mirror the web app's `lib` functions: `createSafe`,
`finishSetup`, `loadBalances`, `preparePayment`, `sendPayment`, `prepareUsdcPayment`, `sendUsdcPayment`,
`loadRulebook`, `requestChange`, `loadActivity`, `beginRecovery`, `completeRecovery`, `prepareAppUse`,
`sendAppUse`, `prepareDappTransaction`, `sendDappTransaction`, and the assistant's `resolveDraft` / `mergeAnswer`.
Prepared payments stay inside the core and are referred to by an id, so Swift never re-serializes a transaction.

The core calls back into Swift (`window.webkit.messageHandlers.native`) for: `faceId.create`,
`faceId.sign(message)`, `vault.save`, `vault.unlock` (Face ID), `vault.delete`, `storage.get/set/del`.

## Native side of the bridge (what Swift implements)

Calls from the core (`{ id, method, params }`), answered with `window.sqwNative.reply(id, ok, json)`:

| Method | Params | Answer | Native implementation |
|---|---|---|---|
| `faceId.create` | `label` | `{ keyId, publicKey }`: uncompressed P-256 point, hex (65 bytes) | `SecureEnclave.P256.Signing.PrivateKey` with `.privateKeyUsage, .biometryCurrentSet`; keep its `dataRepresentation` in the Keychain under `keyId` |
| `faceId.sign` | `keyId`, `message` (hex), `reason` | `{ signature }`: DER, hex | `signature(for: message)` (CryptoKit hashes with SHA-256), Face ID prompt with `reason` |
| `faceId.confirm` | `keyId`, `reason` | `{}` | `LAContext.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics)` |
| `vault.save` | `walletId`, `mpcShare`, `pocketKey` (hex) | `{}` | one Keychain item, `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly` + `.biometryCurrentSet` |
| `vault.unlock` | `walletId`, `reason` | `{ mpcShare, pocketKey }` | read that item (the Keychain shows Face ID) |
| `device.forget` | — | `{}` | delete the vault item and the Face ID keys ("Lose this phone") |
| `storage.get` / `storage.set` / `storage.del` | `key`, `value` (string) | `{ value }` / `{}` | `UserDefaults` (public data only) |
| `recoveryKey.register` / `recoveryKey.authenticate` | `options` | `{ response }` | `ASWebAuthenticationSession` with the page above |

One-way events from the core: `{ event: "keygen-progress" | "recovery-progress", data: { round, total } }`.
Swift calls the core with `callAsyncJavaScript("return await sqwCore.call(method, args)")`, `args` a JSON array
string, and decodes the JSON string it returns: `{ ok, value }` or `{ ok: false, error: { name, message, … } }`.
The methods are listed in [`apps/ios-core/src/api.ts`](../apps/ios-core/src/api.ts);
[`test/fake-native.ts`](../apps/ios-core/test/fake-native.ts) is a working reference for this table.

## Build order (each step works end to end before the next)

1. **Core: done.** `apps/ios-core`: `pnpm --filter @sqw/ios-core build` writes `dist/` (index.html,
   wallet-core.js, dkls.wasm) for the app bundle. `pnpm --filter @sqw/ios-core check` runs it in headless
   Edge/Chrome with a stand-in for the iOS side, against `pnpm dev`. Passed on 2026-10-11: MPC key generated in
   about 3 s, Swissquote registered the safe and verified both ownership proofs, balances and rules read, and a
   USDC 0.10 payment to Léo signed by Face ID alone, in the Secure Enclave's format, was accepted on Base
   ([`0x609f126b…`](https://sepolia.basescan.org/tx/0x609f126b91d427591770e5bc3f214c13d218ba87896af70ee0658535c07587c4)).
   The recovery-key page is in place (`/native/recovery-key`).
2. **Xcode project** (Mac): app shell, theme, `WalletCore` bridge, scheme handler, Face ID key, Keychain vault.
   Check: core loads, DKLs keygen runs in the Simulator against the local services.
3. **Core story**: login, onboarding, home, Bitcoin send (pocket and Savings), receive, recovery. Run Acts 1, 2
   (Bitcoin), 4 and 5 of `docs/demo-script.md` in the Simulator.
4. USDC on Base (Face ID signature on-chain), rules, activity and alerts, attacker mode, Swissquote offline.
5. Assistant (native speech), Explore, Uniswap and Aave, WalletConnect (reown-swift).
6. Device run, README and demo script updates, commit.

## To verify on the Mac before relying on it

- Xcode and iOS versions on the Mac; the reown-swift (WalletKit) version: check its releases, never guess.
- Secure Enclave keys in the Simulator (if unavailable there, the Simulator build reports it plainly and Face ID
  signing is tested on a device).
- App Transport Security: `NSAllowsLocalNetworking` for the services on the Mac; the Mac's address in one setting.
- `ASWebAuthenticationSession` with the recovery-key page in the Simulator.
