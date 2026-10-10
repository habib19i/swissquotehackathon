# Swissquote Wallet — hackathon prototype

A self-custody wallet Swissquote could launch for its clients: **their keys, their control, one step away from their Swissquote account.** Built for the Swissquote Wallet Challenge (EPFL, October 2026).

> Status: M1 done (Bitcoin core on signet, see below). The full spec lives in [`CLAUDE.md`](CLAUDE.md). The README sections required by the brief (custody and threat model, architecture diagram, Travel Rule, business model, bonus topics, AI tools) are filled in by workstream 5.

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

## Real vs mock (so far)

| Component | Status |
|---|---|
| MPC 2-of-3 threshold signatures | Real (DKLs23) |
| Swissquote co-signer | Mock (separate process) |
| Recovery provider / TEE | Mock (separate process) |
| KYC and face check | Mock |
| Sanctions list | Mock |
| Wallet passkey (Face ID) | Real (WebAuthn with PRF) |
| Swissquote login | Mock (client already verified) |
| Family contacts | Demo data (Mock), as if imported from Swissquote |
| BTC/CHF price | Real (CoinGecko), fixed demo price if unavailable (labelled) |
| Bitcoin signet transactions | Real |
| Base Sepolia transactions | Real (M0 spike; app from M4) |
