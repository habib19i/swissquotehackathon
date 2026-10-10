# Swissquote Wallet — hackathon prototype

A self-custody wallet Swissquote could launch for its clients: **their keys, their control, one step away from their Swissquote account.** Built for the Swissquote Wallet Challenge (EPFL, October 2026).

> Status: M0 done (real 2-of-3 MPC, see below). The full spec lives in [`CLAUDE.md`](CLAUDE.md). The README sections required by the brief (custody and threat model, architecture diagram, Travel Rule, business model, bonus topics, AI tools) are filled in by workstream 5.

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
| `packages/mpc` | 2-of-3 threshold ECDSA (DKLs23): keygen, sign, refresh, lost-share recovery | Everyone |
| `spikes/m0-mpc` | M0 spike: real signet and Base Sepolia transactions signed by the MPC key | — |
| `docs/prompts` | Claude Code prompts and the approved spec elements | Everyone |

Bitcoin wallet logic (workstream 1) lives in `packages/shared` and `apps/web` once M1 starts.

## Running locally

Requirements: Node.js 22.13 or later, pnpm 10.

```bash
cp .env.example .env
pnpm install
pnpm dev        # starts the web app (3000), co-signer (4001) and recovery provider (4002)
pnpm test
```

Each service is a separate process with its own SQLite file, as the brief requires.

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

## Real vs mock (so far)

| Component | Status |
|---|---|
| MPC 2-of-3 threshold signatures | Real (DKLs23) |
| Swissquote co-signer | Mock (separate process) |
| Recovery provider / TEE | Mock (separate process) |
| KYC and face check | Mock |
| Sanctions list | Mock |
| Bitcoin signet and Base Sepolia transactions | Real (from M1) |
