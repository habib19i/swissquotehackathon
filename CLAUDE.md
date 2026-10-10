# CLAUDE.md — Swissquote Wallet (hackathon prototype)

Read this whole file before every task. It is the single source of truth for the project. If a task conflicts with this file, stop and ask.

---

## 1. Mission

You are building a hackathon prototype for the Swissquote Wallet Challenge (EPFL, Oct 2026): a self-custody wallet Swissquote could launch for its clients.

**NON-NEGOTIABLE:** the core story must work end to end on testnets:
**create wallet → authenticate and sign a real transaction → lose the phone → recover access.**

Judging: technical 35, security & custody 20, legal 15, business 15, UX & pitch 15, bonus up to +20 (gasless, compliant dApp interaction), awarded only if the core story works.

Priority order: core story first, polish second, bonus third.

## 2. Users and UX

**Why this exists:** Swissquote's wealthy clients want to experience bitcoin and DeFi without being fully exposed to the dangers of the crypto world. They expect to feel supported by Swissquote at every step, even though they hold their own keys.

**Who they are:** mostly older, non-crypto-native clients diversifying their portfolio. Most don't know what a wallet is.

UX rules:
- As simple as Twint. Face ID is the only "password".
- Never show a seed phrase. Never use the words "seed", "private key" or "gas".
- No raw addresses on main screens: people are shown as contact names.
- Large text, high contrast, one action per screen, plain language.
- Swissquote's protection is visible: checks, alerts, "Protected by Swissquote" cues.
- Metaphor: "your safe", with a "Spending pocket" and a "Savings safe".
- Mobile-first web app that works in a phone browser.

**Look:** calm, bank-grade, Swiss-precise. Swissquote-inspired colours and typography, with "Swissquote Wallet — hackathon prototype" clearly shown. Large type, generous spacing, no crypto-style neon or charts-first dashboards.

## 3. Scope

One app, many wallets (Phantom-style), with assets shown side by side:
- Bitcoin (BTC) on Bitcoin **signet** (testnet)
- USDC on **Base Sepolia** (Ethereum L2 testnet)

Build order: the Bitcoin story first, end to end. Ethereum/USDC is added once Bitcoin works.

Network fees are absorbed by Swissquote on the Premium plan and paid by the client on the Standard plan (section 7). The client never needs to buy ETH.

## 4. Honesty and mocking rules

- **Never implement your own cryptography.** Use established open-source libraries only.
- Anything not buildable in a hackathon (bank backend, KYC/face check, sanctions provider, TEE) may be **mocked**, but every mock is labelled "Mock" in the UI and listed in the README.
- Each mocked key-share holder (Swissquote co-signer, recovery provider) runs as a **separate process with its own storage**. The client app must never hold their shares.
- **Never fake success.** Show real transaction IDs and explorer links. If something fails, say so.

## 5. Custody model: MPC 2-of-3

One key, created already split into 3 shares, never whole anywhere:

| Share | Holder | Protection |
|---|---|---|
| 1 | Client's phone | Encrypted, unlocked only by the client's **wallet passkey** (Face ID) |
| 2 | Swissquote co-signer service | Separate process, own database |
| 3 | Independent recovery provider | Separate process, own database; represents a TEE in production |

Any 2 shares sign. **Swissquote alone can never move funds.** One MPC key system serves both Bitcoin and Ethereum.

**Library:** use an established open-source MPC/TSS library. The first build step verifies it can sign a Bitcoin signet transaction (section 11, milestone M0). If no library works within the time box, use the MockMPC fallback (section 11).

### Two different passkeys
- **Wallet passkey:** on the phone, device-bound, unlocks share 1 for daily use. Lost with the phone.
- **Recovery passkey:** separate, registered only with the recovery provider, never used for daily payments. The client chooses: a **hardware security key** shipped by Swissquote (default, shown in the demo) or a **synced passkey** (iCloud/Google) for convenience, with a clear warning.

## 6. The rulebook

The client's rules are the approved contacts, the daily limit and the Spending pocket size.
- Approved contacts form a **Merkle tree**. Only the Merkle root is stored on-chain (Ethereum smart account).
- The root and the limits can **only** be changed with the MPC key (2 of 3 shares).
- Daily payments within the rules need only the phone (Face ID). **Swissquote does not sign everyday payments.**

Who can change the rulebook:
- phone + Swissquote: normal changes, with Swissquote's checks
- phone + recovery provider: when Swissquote is down or gone
- Swissquote + recovery provider: recovery only (recovery passkey + face check + waiting period)

Safety rule, enforced by the contract/services (the UI only displays it):
- **Loosening** changes (add a contact, raise the daily limit or pocket size) need the MPC key plus a **24h delay** (demo: about 30s, labelled "Demo mode"), with alerts. The client can cancel during the delay.
- **Tightening** changes (remove a contact, lower a limit, freeze the wallet) are instant.

Defaults: daily limit **100 CHF**, Spending pocket **100 CHF**, both modifiable by the client.

Pitch line: "Swissquote signs the rulebook, not every payment."

## 7. Chains

### Bitcoin (signet)
- **Savings safe:** address controlled by the MPC key (2 of 3). Holds most of the client's BTC.
- **Spending pocket:** small address the phone can spend from alone (Face ID). Default size 100 CHF.
- Bitcoin can't enforce amount or recipient rules in script, so the pocket's **balance** is the limit.
- Refilling the pocket from the Savings safe is an MPC transaction (with Swissquote's checks), triggered automatically when the pocket runs low.
- Payments above the pocket balance or to new recipients go through the Savings safe (MPC + scam shield).
- The pocket key is part of the MPC setup (for example escrowed to the provider, or restored through the MPC refresh), so **recovery restores both the Savings safe and the Spending pocket**. Pick the cleanest established method.
- Libraries: established JS Bitcoin libraries (for example bitcoinjs-lib). Verify versions.

### Ethereum (Base Sepolia, USDC)
- ERC-4337 smart account (Safe or Kernel; verify the current SDKs before choosing).
- Custom validation module (Solidity, OpenZeppelin MerkleProof):
  - Daily payment = wallet passkey signature + Merkle proof that the recipient is an approved contact + amount within the daily limit (default 100 CHF equivalent, tracked per 24h in contract storage).
  - Only an MPC signature can call `setRulebook(newRoot, newLimit)`.
  - Anything outside the rules (new recipient, above the limit) requires the MPC key + scam shield.
- Passkey (P-256) verification via Base's native support (RIP-7212) or an established library.

### Fees: two plans, switchable in a demo settings toggle
- **Premium** (client pays a recovery/MPC subscription): Swissquote absorbs all network fees.
  - Ethereum: the paymaster sponsors gas.
  - Bitcoin: Swissquote's fee service adds a fee input, and both parties sign the same final transaction. A per-client daily cap prevents abuse.
- **Standard** (Swissquote offers MPC/recovery for free): the client pays network fees.
  - Ethereum: fees paid in USDC via the paymaster (the client still never needs ETH).
  - Bitcoin: fee paid from the client's own BTC.
- The confirmation card always states who pays the fee and how much.

## 8. Flows

### Wallet creation
The client is already a Swissquote client with KYC done (mock login).
1. Tap "Open my safe". Face ID creates the wallet passkey (device-bound).
2. MPC key generation runs between the phone, the Swissquote co-signer and the recovery provider. Each keeps only its share.
3. The client registers the recovery passkey (hardware key by default, or synced passkey).
4. The Bitcoin Savings safe, the Spending pocket and the Ethereum smart account are created (the account is deployed on first use).
5. Ownership proof: the wallet signs a message binding it to the client's Swissquote identity (BIP-322 on Bitcoin, ERC-1271 on Ethereum). Swissquote marks it "verified": no whitelist, no screenshots (Travel Rule).
6. Plan choice: Premium or Standard.

No seed phrase is ever shown.

### Recovery (lost phone)
1. The client installs the app on a new phone, and a new wallet passkey is created.
2. The client proves themselves with the recovery passkey to the recovery provider.
3. Swissquote runs a face check against the client's KYC identity (mock: simulated liveness screen).
4. Waiting period: 48h in production, about 60s in the demo, labelled "Demo mode". Alerts on every channel (mocked on screen).
5. During the wait, the real client can cancel from any device or key they still control.
6. After the wait, the provider and Swissquote run an MPC key refresh that issues a new share 1 to the new phone. The old share becomes useless, and the key never leaves the provider's vault.

The provider's vault refuses to act without a valid recovery passkey assertion **and** Swissquote's face-check attestation.

### Swissquote gone
A "Swissquote offline" switch in the demo stops the co-signer service.
- Daily payments within the rulebook still work (phone only).
- Bigger moves and rulebook changes use phone + recovery provider (2 of 3).
- The client can move everything to any address they choose.

### Attacker mode
A live "Attacker mode" button in the demo. Scenario: the thief has the unlocked phone **and** the client's email.
- They try to send 5,000 CHF to themselves: they're not an approved contact, so the payment needs MPC + scam shield and is **blocked**.
- They try to add themselves as a contact: the 24h delay starts, the real client is alerted and cancels from another device.
- They can only pay approved contacts (family) up to 100 CHF, or spend the 100 CHF pocket.
- They try recovery to their own phone: no recovery passkey (the hardware key is at the client's home) and they fail the face check, so recovery is **refused**.

The screen shows each refusal and why, in plain language.

## 9. Scam shield and payment assistant

### Scam shield
Swissquote's checks run when a recipient is **added** to the rulebook (where scams happen), and on any payment outside the rules:
- Sanctions screening of the address (mock list, labelled).
- Known-scam and first-time-recipient warnings in plain language.
- Transaction simulation shown as "You will send X to Y. Fee: …".
- High-value payments (above the limit) need the MPC key plus an extra confirmation step.
- Verdicts, reused from Orchestra's Gatekeeper but **rule-based, not AI**: `APPROVE` / `NEEDS_CONFIRMATION` / `BLOCKED`.
- Swissquote's service recomputes the CHF value itself (Orchestra's safety net) and never trusts the app's numbers.

### Payment assistant
Reuses Orchestra's chat UI and Planner.
- The client types or records a voice note: "Send 50 USDC to my son".
- Speech-to-text: browser speech recognition in the demo, labelled as a mock of Swiss-hosted production speech-to-text.
- The LLM turns the request into a **structured** draft: `{recipient, amount, asset, pocket}`.
- The recipient must match a saved contact. If none matches or the name is ambiguous, the assistant asks ("Which son: Léo or Adam?"). **The AI never invents or accepts an address.**
- The confirmation card is built from the structured draft, not from the AI's text, and shows the amount, recipient and fee.
- The rules (scam shield, rulebook) check the draft. The client taps **Accept** (Face ID) or **Decline**.
- No message can remove the Accept/Face ID step. The assistant holds no key and sends nothing.
- Languages: English, French, German, Italian.

### LLM
- Apertus (Swiss open model) via the Hugging Face router, through its OpenAI-compatible API, behind a single config switch (reuse Orchestra's model switch) so another model can serve as fallback.
- Rules decide, AI explains: the LLM never approves, blocks or signs anything.
- No client identity is ever sent to the LLM: only the request text, contact first names and amounts.
- README and pitch: in production, Apertus runs in Switzerland (self-hosted or on a Swiss sovereign cloud).

## 10. Screens

1. Mock Swissquote login
2. Onboarding: Open my safe → Face ID → recovery key → plan → "Your safe is ready"
3. Home: total in CHF; pockets side by side (BTC Spending, BTC Savings, USDC); "Protected by Swissquote"
4. Send: pick a contact or use the assistant → confirmation card → Face ID
5. Receive: QR code + "Transfer from my Swissquote account" (mock)
6. Contacts & rules (the rulebook): contacts, daily limit, pocket size; pending changes with a countdown and Cancel
7. Alerts / activity feed with explorer links
8. Recovery: "I lost my phone" flow with face check (mock) and countdown
9. Demo panel: Attacker mode, Swissquote offline, plan toggle, Demo-mode timers

Every mock is labelled "Mock".

## 11. Architecture and build

### Repo: fresh monorepo, TypeScript everywhere
- `apps/web`: Next.js mobile-first web app (Ghaith's setup as base)
- `services/cosigner`: Swissquote co-signer: MPC share 2, scam shield, rulebook checks, fee service, mocked KYC/face check, Watcher (alerts). Own process, own SQLite database.
- `services/recovery-provider`: share 3, "TEE" mock, recovery passkey check, waiting period. Own process, own SQLite database.
- `contracts/`: Foundry project for the rulebook validation module.
- `packages/shared`: types, Merkle tree helpers, API clients.
- One command starts everything (for example docker compose or a dev script).

Reuse from Orchestra (github.com/youssef-jeddi/Orchestra): the bridge server with WebSocket approvals, approval overlay cards, Planner prompt, safety-net check, model switch and Safe helpers. **Do not copy** the agent wallet, 0G or Uniswap code.

### MPC risk control (time box: 3 hours)
- Step 1 of the build is a spike: take an established open-source MPC/TSS library and sign and broadcast one Bitcoin signet transaction and one Base Sepolia transaction with a 2-of-3 key.
- If it fails, implement a **MockMPC** service with the **same API** (keygen, sign, refresh), running as its own process and labelled "Mock MPC" in the UI and README. Everything else (rulebook, recovery, attacker mode) still works, and real transactions are still sent.
- Report clearly which path was taken.

### Milestones
- **M0** Spike: MPC library check.
- **M1** Bitcoin core: create wallet (passkey + MPC keygen), Spending pocket send on signet, real txid + explorer link.
- **M2** Services: co-signer and recovery provider as separate processes; Savings safe MPC send; pocket refill.
- **M3** Recovery + attacker mode + Swissquote-offline switch. **Core story complete: freeze and test.**
- **M4** Ethereum: smart account on Base Sepolia, rulebook validation module, paymaster, USDC.
- **M5** Payment assistant (voice/text) + scam shield UI + polish.
- **M6** README, diagrams, demo script.

Never start the next milestone before the current one works end to end.

## 12. Deliverables and working style

The README must include (required by the brief):
- custody model + threat model (who can steal, who can lock out, can Swissquote alone or with a partner move funds?)
- architecture diagram (Mermaid) with real and mocked parts marked
- custody & Travel Rule section (ownership proof; Swissquote is not the sending institution for client-to-third-party payments, flagged as still to be verified legally)
- business model (Premium/Standard plans)
- bonus topics tackled
- AI tools used and what for
- how to run, and the demo script

Working style:
- Start each task with a short plan. Ask before deviating from this architecture.
- Verify library versions online before installing. Never invent package names.
- Write tests for the rulebook contract, Merkle proofs, limits, delays and scam-shield rules.
- Commit after each milestone with a clear message.
- Keep the code clean and readable: it is judged.
