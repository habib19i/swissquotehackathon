# Starter prompts for Claude Code

How to use them:
1. Put `CLAUDE.md` at the root of the repo. Claude Code reads it automatically.
2. **One person runs Prompt 0 first.** It creates the repo skeleton, the shared contracts and the MPC spike. Everyone else waits until it's pushed.
3. Then each workstream owner opens Claude Code on their own branch and pastes their prompt.
4. Merge at each milestone checkpoint (M1, M2, M3…) in the order of `CLAUDE.md` section 11.

---

## Prompt 0: Kickoff (one person, first 3 hours)

```
Read CLAUDE.md fully before doing anything.

Your task is milestone M0 plus the repo skeleton. Nothing else.

1. Write a short plan and show it to me before coding.
2. Create the monorepo exactly as in CLAUDE.md section 11: apps/web, services/cosigner, services/recovery-provider, contracts/, packages/shared, and one command that starts everything.
3. In packages/shared, define the TypeScript interfaces every workstream will code against:
   - MPC service API: keygen, sign, refresh (same API for the real library and MockMPC)
   - Co-signer API: scam-shield verdict (APPROVE / NEEDS_CONFIRMATION / BLOCKED), rulebook change requests with delay and cancel, fee input request, face-check attestation (mock)
   - Recovery-provider API: register recovery passkey, start recovery, cancel, status, complete (key refresh)
   - Rulebook types and Merkle tree helpers (contacts, daily limit, pocket size)
   Keep them minimal; document each endpoint in one line.
4. MPC spike (time box 3 hours): pick an established open-source MPC/TSS library, verify its current version online, and sign + broadcast one Bitcoin signet transaction and one Base Sepolia transaction with a 2-of-3 key. Report the txids and explorer links.
5. If the spike fails within the time box: implement MockMPC with the same API as its own process, labelled "Mock MPC", and explain in the README why.
6. Commit with a clear message and tell me which path (real MPC or MockMPC) was taken.

Do not build any UI or business logic yet.
```

---

## Prompt 1: Bitcoin Core (workstream 1, critical path)

```
Read CLAUDE.md fully, especially sections 4, 5, 7 (Bitcoin) and 11.

You own workstream 1: Bitcoin Core. Work on branch ws1-bitcoin.

Goal for M1, then M2:
- M1: from the web app, create the wallet's Bitcoin side using the MPC API from packages/shared: Savings safe address (MPC key) and Spending pocket address (phone can spend alone, Face ID via the wallet passkey). Send from the Spending pocket on signet and show the real txid + explorer link.
- M2: send from the Savings safe through MPC (phone + co-signer), and implement automatic pocket refill from the Savings safe when the pocket runs low (default pocket size 100 CHF).
- Fees: implement both plans from CLAUDE.md section 7. Premium = co-signer's fee service adds a fee input and both parties sign the same final transaction (per-client daily cap). Standard = fee paid from the client's BTC. The confirmation card must say who pays and how much.
- The pocket key must be recoverable through the MPC setup (section 7); coordinate the method with workstream 4.
- Ownership proof: BIP-322 message binding the wallet to the Swissquote identity (section 8).

Rules: established libraries only (verify versions online), never fake a txid, tests for transaction building and fee logic, start with a short plan and show it to me.
```

---

## Prompt 2: Swissquote Co-signer (workstream 2)

```
Read CLAUDE.md fully, especially sections 4, 6, 9 and 11.

You own workstream 2: the Swissquote co-signer service (services/cosigner). Work on branch ws2-cosigner.

It is a separate process with its own SQLite database. The client app never sees its share or database.

Build:
- MPC share 2 holder, using the MPC API from packages/shared.
- Scam shield (rule-based, NOT AI): runs when a recipient is added to the rulebook and on any payment outside the rules. Mock sanctions list (labelled), first-time/known-scam warnings, plain-language simulation text, verdicts APPROVE / NEEDS_CONFIRMATION / BLOCKED. Recompute the CHF value itself and never trust the app's numbers (reuse Orchestra's Gatekeeper structure and safety-net check from github.com/youssef-jeddi/Orchestra, minus the AI decision).
- Rulebook changes: loosening = MPC + 24h delay (Demo mode ~30s) with alerts and cancel; tightening = instant. Enforce here, not in the UI.
- Fee service for the Premium plan (Bitcoin fee input with per-client daily cap; Ethereum paymaster sponsorship config).
- Mock face check / KYC attestation used by recovery (labelled "Mock").
- Watcher: emits alerts (recovery started, contact added, limit raised) over WebSocket (reuse Orchestra's bridge server + approval events).
- A "Swissquote offline" switch that stops the service for the demo.

Later (after the M3 checkpoint): help workstream 4 with the Ethereum add-on.

Rules: tests for every scam-shield rule, delay and cancel path; start with a short plan and show it to me.
```

---

## Prompt 3: App & UX, including the payment assistant (workstream 3)

```
Read CLAUDE.md fully, especially sections 2, 8, 9 and 10.

You own workstream 3: the web app (apps/web). Work on branch ws3-app.

Build the 9 screens listed in CLAUDE.md section 10, mobile-first, for older non-crypto clients:
- Follow every UX rule in section 2: Face ID only, no seed phrase, no 'seed' / 'private key' / 'gas', contact names instead of addresses, large text, one action per screen, visible "Protected by Swissquote" cues, Swissquote-inspired look labelled "Swissquote Wallet — hackathon prototype".
- Wallet passkey (device-bound) via WebAuthn; share 1 encrypted with a key derived from the passkey (verify an established WebAuthn library online).
- Rulebook screen: contacts, daily limit, pocket size, pending changes with countdown + Cancel.
- Confirmation card: built from structured data; shows amount, recipient, who pays the fee and how much; Accept (Face ID) / Decline.
- Demo panel: Attacker mode, Swissquote offline, plan toggle (Premium/Standard), Demo-mode timers.
- Every mock labelled "Mock".

Then the payment assistant (M5): reuse Orchestra's chat UI, Planner and model switch (github.com/youssef-jeddi/Orchestra). Text or voice (browser speech recognition, labelled mock) -> LLM (Apertus via Hugging Face router, OpenAI-compatible) -> structured draft {recipient, amount, asset, pocket} -> confirmation card. Recipient must match a saved contact, otherwise ask. The AI never invents an address and nothing can skip Accept/Face ID. No client identity sent to the LLM. Languages EN/FR/DE/IT.

Start with stubs against the packages/shared interfaces so you aren't blocked by other workstreams. Start with a short plan and show it to me.
```

---

## Prompt 4: Recovery & Attacker Mode (workstream 4)

```
Read CLAUDE.md fully, especially sections 5, 8 and 11.

You own workstream 4: recovery, attacker mode and the recovery provider (services/recovery-provider). Work on branch ws4-recovery.

Build:
- The recovery provider as a separate process with its own SQLite database, holding MPC share 3 ("TEE" mock, labelled).
- Recovery passkey registration: hardware security key by default, synced passkey as an option with a warning.
- The vault refuses to act without a valid recovery passkey assertion AND Swissquote's face-check attestation (from workstream 2).
- Recovery flow exactly as CLAUDE.md section 8: new phone -> new wallet passkey -> recovery passkey -> face check (mock) -> waiting period (48h, Demo mode ~60s) with alerts -> cancel possible from any device/key -> MPC key refresh issuing a new share 1; old share useless. Recovery must also restore the Spending pocket (coordinate the method with workstream 1).
- "Swissquote gone" path: phone + recovery provider can sign and change the rulebook when the co-signer is offline.
- Attacker mode scenario exactly as section 8: blocked 5,000 CHF payment, delayed self-added contact cancelled by the real client, only approved contacts up to 100 CHF, recovery refused. Each refusal explained in plain language on screen.

This is milestone M3: the core story must be complete and tested here. Then (M4), with workstream 2: the Ethereum add-on: ERC-4337 smart account on Base Sepolia (verify Safe vs Kernel SDKs online), the rulebook validation module in contracts/ (passkey signature + Merkle proof + daily limit; only MPC can call setRulebook), paymaster (sponsored on Premium, USDC on Standard), Foundry tests.

Start with a short plan and show it to me.
```

---

## Prompt 5: Pitch, Legal & Business (workstream 5, Wassila)

```
Read CLAUDE.md fully, especially sections 1, 4, 5, 6, 8 and 12.

You own workstream 5: the written deliverables. Work on branch ws5-docs, in a docs/ folder and the README. Do not change application code.

Draft:
1. README skeleton with every section required in CLAUDE.md section 12, filled with what is already decided; mark anything that depends on the build as TODO.
2. Custody model + threat model: who could steal funds, who could lock the client out, can Swissquote alone or with a partner move funds (answer: no; explain the 2-of-3 MPC, the recovery provider's TEE and the two passkeys). Include the attacker-with-phone-and-email case and the "Swissquote gone" case.
3. Architecture diagram in Mermaid: apps/web, co-signer, recovery provider, MPC, Bitcoin signet, Base Sepolia, paymaster, LLM; mark each part Real or Mock.
4. Custody & Travel Rule section: why this is not custody (Swissquote holds 1 of 3 shares), automatic ownership proof at wallet creation (BIP-322 / ERC-1271) replacing whitelists and screenshots, and the argument that Swissquote is not the sending institution for client-to-third-party payments. Flag every legal claim "to verify with a lawyer"; do not invent regulation names or article numbers.
5. Business model: Premium plan (subscription, Swissquote absorbs fees) vs Standard plan (free MPC/recovery, client pays fees); retention, lower ownership-verification costs, new clients.
6. Bonus topics tackled: gasless (paymaster / Swissquote fee input), compliant dApp interaction (scam shield, simulation, high-value checks).
7. AI tools log: Claude (brainstorming, research, specs, this prompt set), Claude Code (implementation), Apertus (payment assistant). Leave a table to complete.
8. A 3-minute demo script following the core story, then attacker mode, then Swissquote offline.

Write in plain English for bank judges. Start with a short plan and show it to me.
```
