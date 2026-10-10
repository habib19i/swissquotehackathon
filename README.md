# Swissquote Wallet — hackathon prototype

A self-custody wallet Swissquote could launch for its clients: **their keys, their control, one step away from their Swissquote account.** Built for the Swissquote Wallet Challenge (EPFL, October 2026).

> Status: M3 done: the core story works end to end on signet (create, pay, lose the phone, recover). See below. The full spec lives in [`CLAUDE.md`](CLAUDE.md). The README sections required by the brief (custody and threat model, architecture diagram, Travel Rule, business model, bonus topics, AI tools) are filled in by workstream 5.

## The idea in one paragraph

The client's key is split into three MPC shares: one on their phone (unlocked by Face ID), one at Swissquote, one at an independent recovery provider. Any two can sign, so **Swissquote alone can never move funds**. Everyday payments to approved contacts, within a daily limit, need only the phone: **Swissquote signs the rulebook, not every payment.** If the phone is lost, a separate recovery passkey plus a face check and a waiting period restore access. If Swissquote disappears, the phone and the recovery provider still let the client move everything out.

## Repository layout

| Path | What it is | Owner |
|---|---|---|
| `apps/web` | Next.js mobile-first web app | Workstream 3 (App & UX) |
| `services/cosigner` | Swissquote co-signer (**mock**): MPC share 2, scam shield, rulebook delays, fees | Workstream 2 |
| `services/recovery-provider` | Independent recovery provider (**mock**, TEE simulated): MPC share 3, recovery | Workstream 4 |
| `contracts` | Foundry project: rulebook validation module (Base Sepolia) | Workstream 4 |
| `packages/shared` | Types, service contracts, Merkle/rulebook helpers | Everyone |
| `packages/mpc` | 2-of-3 threshold ECDSA (DKLs23): keygen, sign, refresh, lost-share recovery; networked protocol and service routes | Everyone |
| `packages/bitcoin` | Savings safe and Spending pocket addresses, pocket payments, signet API client | Workstream 1 |
| `spikes/m0-mpc` | M0 spike and checks: real signet and Base Sepolia transactions signed by the MPC key | — |
| `docs/prompts` | Claude Code prompts and the approved spec elements | Everyone |

## Running locally

Requirements: Node.js 22.13 or later, pnpm 10.

```bash
cp .env.example .env
pnpm install
pnpm dev        # starts the web app (3000), co-signer (4001) and recovery provider (4002)
pnpm test
```

Open http://localhost:3000 in Chrome, Edge or Safari. Face ID uses passkeys (WebAuthn), which need
`localhost` or https. To try it on a real phone on the same network, run the web app with
`pnpm --filter @sqw/web dev:https` and set `DEV_ORIGINS` in `.env` to your computer's IP address.

Each service is a separate process with its own SQLite file, as the brief requires. The browser reaches
them through the web app's origin (`/svc/cosigner`, `/svc/recovery`), a plain proxy that holds no keys.

## How the team works

1. One person runs **Prompt 0** from [`docs/prompts/workstream-prompts.md`](docs/prompts/workstream-prompts.md) (MPC spike).
2. Each workstream opens Claude Code on its own branch and pastes its prompt.
3. Merge at each milestone (M1 → M6) in the order given in `CLAUDE.md` section 11.

## MPC spike (M0): real MPC, no MockMPC

We use **Silence Laboratories DKLs23** (`@silencelaboratories/dkls-wasm-ll-node` 1.2.0) through
[`packages/mpc`](packages/mpc). It gives 2-of-3 distributed key generation, signing by any two holders,
proactive refresh and lost-share recovery, which is exactly the recovery step of the core story.

Real testnet transactions signed by the 2-of-3 MPC key (`pnpm --filter @sqw/spike-m0-mpc send-btc` / `send-eth`):

| Chain | Signed by | Transaction |
|---|---|---|
| Bitcoin signet | phone + Swissquote | [`1f38dfcd…92aec2`](https://mempool.space/signet/tx/1f38dfcd88fc34b07121f8f97dbce613d69a3073da6dcf6c289070195192aec2) |
| Base Sepolia | phone + recovery provider (Swissquote offline) | [`0x1dabbe…57a9c9`](https://sepolia.basescan.org/tx/0x1dabbed9cfe3524a57be0fcb4ac319d27acb1a0ae36503f6a10c43343957a9c9) |

**License caveat (to flag in the legal section):** DKLs23 is source-available under the Silence Laboratories
*non-commercial* license. That is fine for a hackathon prototype; a Swissquote launch would need a
commercial license from Silence Laboratories, or a switch to a permissively licensed library behind the
same `@sqw/mpc` API. Details in [`packages/mpc/README.md`](packages/mpc/README.md).

## Bitcoin core (M1)

**Create the safe.** Face ID creates the *wallet passkey* (WebAuthn, P-256). Its PRF extension turns each
Face ID check into a secret from which the phone derives the AES key that encrypts share 1 and the pocket
key in the browser's storage. The phone then runs DKLs23 key generation (WASM in the browser) with the
co-signer and the recovery provider over HTTP; each keeps only its share in its own database. The two
services seal the messages they send each other (NaCl box), so the phone relays them without being able
to read or alter them. Each service fetches the other's sealing key directly, never through the phone.

**Two Bitcoin addresses.**

| | Script | Who can spend |
|---|---|---|
| Savings safe | P2WPKH of the MPC key | any 2 of 3 (phone, Swissquote, recovery provider) |
| Spending pocket | P2WSH `IF <pocket key> ELSE <MPC key> ENDIF CHECKSIG` | the phone alone (Face ID), **or** the MPC key |

The pocket key never leaves the phone and is never copied or escrowed. If the phone is lost, the 2-of-3
MPC key sweeps the pocket into a new one, so recovery restores the Savings safe *and* the Spending pocket.
Bitcoin script cannot limit amounts or recipients, so the pocket's balance is the limit (CLAUDE.md §7).

Real signet transactions:

| What | Transaction |
|---|---|
| Pocket payment from the app (Face ID, pocket key only) | [`1b81d0e4…607cfa`](https://mempool.space/signet/tx/1b81d0e47c7f2a2ba119e4f0e3ca3eb3dea919b074912ce4f7701e661a607cfa) |
| Pocket script, pocket-key branch (`pnpm pocket-check spend`) | [`56cc1955…d2b9f1`](https://mempool.space/signet/tx/56cc1955a15ba9873ce4d85397704869ad85be7bca1debfdeca6450883d2b9f1) |
| Pocket script, MPC branch: the recovery sweep | [`16f68f78…a152c4`](https://mempool.space/signet/tx/16f68f7865c8cf7e46848778fac1e0d053956a33cf860297921f61fe2fa152c4) |

**Prototype limitations.** A web app cannot force a passkey to stay on one device: Apple and Google may
sync it. The phone's encrypted share still lives only in that browser's storage. A native app would use a
device-bound Secure Enclave / StrongBox key. Browsers without PRF fall back to a non-extractable device key,
with Face ID gating each use; the app says so when it happens.

## Services and the Savings safe (M2)

**Swissquote signs the rulebook, not every payment.** Pocket payments need only the phone. Everything
that moves the Savings safe is signed by the phone **and** a second key holder, and each holder decides
for itself what it signs:

1. The phone asks Swissquote to co-sign one input of a transaction (`POST /mpc/sign` with the PSBT).
2. Swissquote rebuilds the transaction, takes every input's value from the Bitcoin network (never from
   the app), recomputes CHF values at its own price, and runs its rules: coins must come from the client's
   Savings safe, a refill must go to the client's registered pocket and not overfill it, the fee must be
   sane, and the **scam shield** judges the recipient (`APPROVE` / `NEEDS_CONFIRMATION` / `BLOCKED`).
3. Swissquote computes the digest itself and returns it; the phone compares it with its own and stops if
   they differ. Only then do both run DKLs23 signing. Each pre-signature is used once.

| Scam shield rule (rule-based, no AI) | Verdict |
|---|---|
| Approved contact, within the CHF 100 daily limit | APPROVE |
| Approved contact, above the daily limit | NEEDS_CONFIRMATION (extra tap on the card) |
| First-time recipient, within the limit | NEEDS_CONFIRMATION, scam warning |
| First-time recipient, above the limit (attacker mode: CHF 5,000 to the thief) | BLOCKED |
| Sanctioned or reported scam address (mock lists) | BLOCKED |
| Frozen safe | BLOCKED |

**Pocket refill.** After a payment leaves the Spending pocket below half of its size, the same Face ID
check refills it from the Savings safe (phone + Swissquote), up to CHF 100.

**Ownership proof (Travel Rule).** At creation, the Savings safe signs a BIP-322 message binding it to the
client's Swissquote client number (phone + Swissquote, with `bip322-js`). Swissquote verifies it and marks
the safe "verified": no whitelist, no screenshots. Registration is write-once, so the refill destination
cannot be redirected later.

**Plans and fees.** On the **Standard** plan the client pays the network fee from their own bitcoin. On
**Premium**, Swissquote's fee service adds one coin of its own to the transaction: the client's coins
cover exactly the amount, Swissquote's coin covers the fee, and both sign the same final transaction.
Swissquote signs its coin only if it pays nothing but the fee, at most 1.5× the rate it offered, within a
per-client daily cap (default 5,000 sats). If it cannot sponsor, the client pays and the card says why.

Real signet transactions from the app:

| What | Signed by | Transaction |
|---|---|---|
| Automatic pocket refill from the Savings safe | phone + Swissquote (MPC) | [`db910505…`](https://mempool.space/signet/tx/db910505152cd25c73ff30577b341eafada1c459f5c4066c4b253b57b9d20cc5) |
| Payment to Sofia from the Savings safe | phone + Swissquote (MPC) | [`911728a3…`](https://mempool.space/signet/tx/911728a306379580ff63b8e8a9a654d458351effb3d46ba00943622b1478749f) |
| Payment to Léo above the daily limit (client confirmed the extra step) | phone + Swissquote (MPC) | [`d6d6920b…`](https://mempool.space/signet/tx/d6d6920b893f410d96fa70a429adf9c25132f21303bc7b82df8edc681ccdea77) |
| Automatic refill right after it | phone + Swissquote (MPC) | [`fd22de9c…`](https://mempool.space/signet/tx/fd22de9c82db3da7dd509440f486a68844eb96ca6217842499043b4a1ae99df2) |
| Premium: pocket payment, network fee paid by Swissquote's coin | pocket key + Swissquote's fee coin | [`618856cf…`](https://mempool.space/signet/tx/618856cf9a2c548d4bed5a13d533ad95d86ce03686afa49a164ae48235feaabf) |

**Test bitcoin for demos.** A Swissquote demo account (Mock; the same operational wallet that pays Premium
fees) powers "Transfer from my Swissquote account" on the Receive screen: it sends from confirmed coins,
so transfers are spendable within seconds. The demo family's wallets are mock wallets whose keys the demo
account holds; it collects what they receive every 10 minutes, so test bitcoin keeps circulating and only
network fees are used up. Fund it once from a signet faucet (Plan and settings shows its address and
balance), ideally the day before a demo: faucet payouts often sit on long unconfirmed chains until a block.

## Recovery, attacker mode, Swissquote offline (M3): the core story

**Lose the phone, keep the safe.** On a new phone the client logs in to Swissquote (mock), creates a new
Face ID passkey, presents the **recovery key** (a second passkey registered only with the recovery
provider: a security key by default, or a synced passkey with a warning) and passes Swissquote's face check
(mock liveness; Swissquote signs the result with BIP-340 Schnorr). The provider verifies both, alerts the
client, and starts a waiting period (48 h; 60 s in demo mode) during which the real client can cancel from
any device. Then Swissquote, the provider and the new phone run DKLs23 lost-share recovery: **same key, same
Savings safe address, new shares for everyone**; both services overwrite their old share, so the lost phone's
share is useless. Each service decides for itself: the provider checks its own recovery record, Swissquote
asks the provider directly and checks its own face-check record. Finally the new phone gets a new pocket key,
Swissquote moves the refill destination (only for a completed recovery), and the old pocket is swept into the
new one through the pocket script's MPC branch.

**Swissquote gone.** With the "Swissquote offline" switch, pocket payments work as usual. Savings payments are
signed by the phone and the recovery provider instead. The provider checks for itself that Swissquote is down,
and only co-signs a transaction the client approved with the **recovery key**, so a thief holding the phone
cannot use an outage to empty the safe (an addition to the brief, on purpose).

**Rulebook changes** are signed with the MPC key (phone + Swissquote). Tightening (remove a contact, lower a
limit, freeze) applies at once; loosening (add a contact, raise a limit, unfreeze) waits 24 h (30 s in demo mode)
with alerts and can be cancelled from any device. New contacts go through the scam shield's sanctions and
scam lists first.

**Attacker mode** (thief with the unlocked phone and the client's email), each attempt against the real services:

| Attempt | Result |
|---|---|
| Send CHF 5,000 to himself | Stopped: Swissquote blocks large payments to someone never paid |
| Add himself as a contact | On hold for 24 h, client alerted everywhere, cancelled from the client's other device |
| Take what the rules allow | Only the Spending pocket, never more than its CHF 100 size |
| Move the safe to his own phone | Refused: no recovery key, face check failed |

Real signet transactions:

| What | Signed by | Transaction |
|---|---|---|
| Old pocket swept into the new phone's pocket after recovery | new phone + Swissquote (MPC branch) | [`cb993fb6…`](https://mempool.space/signet/tx/cb993fb65b114874a4d250e7967dc198884971aeda86db554d1598b86df39b23) |
| Savings payment while Swissquote was offline | phone + recovery provider, approved with the recovery key | [`0d4357ab…`](https://mempool.space/signet/tx/0d4357ab57b22ce8763140415dae2f98b4203747f0b98d0aa096a8452a4c1dca) |

**Known limits of the prototype.** Recovery attempts that are started but never verified stay open (no expiry
yet). If a service failed in the very last round of a recovery while the other had already replaced its share,
the shares would disagree and the recovery would need to be run again; production would make the final round
two-phase. Alerts reach the app and a mock e-banking page by polling; real channels (push, SMS, email) are mocked.

## Real vs mock (so far)

| Component | Status |
|---|---|
| MPC 2-of-3 threshold signatures | Real (DKLs23) |
| Swissquote co-signer | Mock (separate process) |
| Recovery provider / TEE | Mock (separate process; TEE simulated) |
| Recovery key (second passkey) | Real (WebAuthn, verified with @simplewebauthn/server) |
| KYC and face check | Mock (simulated liveness; Swissquote's signed attestation is real) |
| Alert channels (push, SMS, email) | Mock (shown in the app and a mock e-banking page) |
| Sanctions and known-scam lists | Mock (labelled in the app) |
| Swissquote fee wallet (Premium) | Real signet coins; key in the co-signer's database (Mock HSM) |
| Wallet passkey (Face ID) | Real (WebAuthn with PRF) |
| Swissquote login | Mock (client already verified) |
| Family contacts | Demo data (Mock), as if imported from Swissquote |
| BTC/CHF price | Real (CoinGecko), fixed demo price if unavailable (labelled) |
| Bitcoin signet transactions | Real |
| Base Sepolia transactions | Real (M0 spike; app from M4) |
