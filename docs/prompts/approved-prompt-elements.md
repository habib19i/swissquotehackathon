# Approved prompt elements (Claude Code master prompt)

## A1 Mission — APPROVED
You are building a hackathon prototype for the Swissquote Wallet Challenge (EPFL, Oct 2026): a self-custody wallet Swissquote could launch for its clients.
NON-NEGOTIABLE: the core story must work end to end on testnets: create wallet -> authenticate and sign a real transaction -> lose the phone -> recover access.
Judging: technical 35, security & custody 20, legal 15, business 15, UX & pitch 15, bonus up to +20 (gasless, compliant dApp interaction) only if the core story works.
Priority order: core story first, polish second, bonus third.

## A2 Users — APPROVED
WHY THIS EXISTS: Swissquote's wealthy clients want to experience bitcoin and DeFi without being fully exposed to the dangers of the crypto world. They expect to feel supported by Swissquote at every step, even though they hold their own keys.
WHO THEY ARE: mostly older, non-crypto-native clients diversifying their portfolio. Most don't know what a wallet is.
UX rules:
- As simple as Twint. Face ID is the only 'password'.
- Never show a seed phrase; never use the words 'seed', 'private key', 'gas'.
- No raw addresses on main screens; people are shown as contact names.
- Large text, high contrast, one action per screen, plain language.
- Swissquote's protection is visible: checks, alerts, 'Protected by Swissquote' cues.
- Metaphor: 'your safe' with a 'Spending pocket' and a 'Savings safe'.
- Mobile-first web app (works in a phone browser).

## B1 MPC — APPROVED
Custody model: MPC threshold signatures, 2-of-3.
One key, created already split into 3 shares, never whole anywhere:
- Share 1: client's phone, encrypted and unlocked only by the client's passkey (Face ID).
- Share 2: Swissquote co-signer service (separate process, own database).
- Share 3: independent recovery provider (separate process, own database; represents a TEE in production).
Any 2 shares sign. Swissquote alone can NEVER move funds.
One MPC key system serves both Bitcoin and Ethereum.
Library: use an established open-source MPC/TSS library. In the first step, verify it can sign a Bitcoin signet transaction. If no library works within the time box, use the fallback in section F (mocked MPC signer as a separate process, clearly labelled).

## B2 Recovery — APPROVED
Two different passkeys:
- WALLET PASSKEY: on the phone, device-bound, unlocks share 1 for daily use. Lost with the phone.
- RECOVERY PASSKEY: separate, registered only with the recovery provider. Never used for daily payments. Client's choice: hardware security key shipped by Swissquote (default, shown in the demo) or a synced passkey (iCloud/Google) for convenience, with a clear warning.
Recovery (lost phone):
1. Client installs the app on a new phone; a new wallet passkey is created.
2. Client proves themselves with the RECOVERY passkey to the recovery provider.
3. Swissquote runs a face check against the client's KYC identity (MOCK: simulated liveness screen).
4. Waiting period: production 48h, demo ~60s labelled 'Demo mode'. Alerts on every channel (mocked on screen).
5. During the wait, the real client can cancel from any device or key they still control.
6. After the wait, the provider and Swissquote run an MPC key refresh that issues a NEW share 1 to the new phone; the old share becomes useless. The key never leaves the provider's vault.
The provider's vault refuses to act without a valid RECOVERY passkey assertion AND Swissquote's face-check attestation.
Swissquote gone: phone + provider still make 2 of 3, so the client can always move funds out.

## B4 Loosening delay — APPROVED
- LOOSENING changes (add a contact, raise the daily limit or pocket size) need the MPC key + a 24h delay (demo: ~30s, 'Demo mode') with alerts; the client can cancel during the delay.
- TIGHTENING changes (remove a contact, lower a limit, freeze the wallet) are instant.
- The contract/service enforces this; the UI only displays it.

## C2 Bitcoin — APPROVED
Bitcoin side (signet):
- SAVINGS SAFE: address controlled by the MPC key (2 of 3). Holds most of the client's BTC.
- SPENDING POCKET: small address the phone can spend from alone (Face ID). Default size 100 CHF, modifiable via MPC + 24h delay.
- Bitcoin can't enforce amount or recipient rules in script, so the pocket's BALANCE is the limit.
- Refilling the pocket from the Savings safe = an MPC transaction (with Swissquote's checks), triggered automatically when it runs low.
- Payments above the pocket balance or to new recipients go through the Savings safe (MPC + scam shield).
- Libraries: established JS Bitcoin libraries (e.g. bitcoinjs-lib); verify versions.

## C3 Pocket recovery — APPROVED
The pocket key is part of the MPC setup (e.g. escrowed to the provider / restored through the MPC refresh), so recovery restores both the Savings safe AND the Spending pocket. Claude Code picks the cleanest established method.

## C4 Fees — APPROVED (A3 fee line replaced accordingly)
Two plans, switchable in a demo settings toggle:
- PREMIUM (client pays a recovery/MPC subscription): Swissquote absorbs all network fees.
  - Ethereum: paymaster sponsors gas.
  - Bitcoin: Swissquote's fee service adds a fee input; both parties sign the same final transaction; per-client daily cap against abuse.
- STANDARD (Swissquote offers MPC/recovery for free): the client pays network fees.
  - Ethereum: fees paid in USDC via the paymaster (client still never needs ETH).
  - Bitcoin: fee paid from the client's own BTC.
The confirmation card always states who pays the fee and how much.
A3 fee line: 'Network fees are absorbed by Swissquote on the Premium plan and paid by the client on the Standard plan; the client never needs to buy ETH.'

## D1 Wallet creation — APPROVED
Wallet creation (client already a Swissquote client, KYC done — MOCK login):
1. Tap 'Open my safe'. Face ID creates the WALLET passkey (device-bound).
2. MPC key generation runs between phone, Swissquote co-signer and recovery provider; each keeps only its share.
3. Client registers the RECOVERY passkey (hardware key by default, or synced passkey).
4. Bitcoin Savings safe + Spending pocket and the Ethereum smart account are created (account deployed on first use).
5. Ownership proof: the wallet signs a message binding it to the client's Swissquote identity (BIP-322 on Bitcoin, ERC-1271 on Ethereum). Swissquote marks it 'verified' — no whitelist, no screenshots (Travel Rule).
6. Plan choice: Premium or Standard.
No seed phrase is ever shown.

## D2 Attacker mode — APPROVED
Attacker mode (a live 'Attacker mode' button in the demo):
Scenario: thief has the unlocked phone AND the client's email.
- Tries to send 5,000 CHF to themselves: not an approved contact -> needs MPC + scam shield -> BLOCKED.
- Tries to add themselves as a contact: 24h delay starts, real client alerted, cancels from another device.
- Can only pay approved contacts (family) up to 100 CHF, or spend the 100 CHF pocket.
- Tries recovery to their own phone: no RECOVERY passkey (hardware key at the client's home) and fails the face check -> REFUSED.
The screen shows each refusal and why, in plain language.

## D3 Swissquote gone — APPROVED
'Swissquote offline' switch in the demo stops the co-signer service.
- Daily payments within the rulebook still work (phone only).
- Bigger moves and rulebook changes use phone + recovery provider (2 of 3).
- The client can move everything to any address they choose.

## C5 Scam shield — APPROVED (wording 'Fee paid by Swissquote' to follow C4)
Scam shield = Swissquote's checks when a recipient is ADDED to the rulebook (where scams happen), and on any payment outside the rules:
- Sanctions screening of the address (MOCK list, labelled).
- Known-scam / first-time-recipient warnings in plain language.
- Transaction simulation shown as: 'You will send X to Y. Fee: ...'
- High-value payments (above the limit) need the MPC key + an extra confirmation step.
- Verdicts (reused from Orchestra's Gatekeeper, but RULE-BASED, not AI): APPROVE / NEEDS_CONFIRMATION / BLOCKED.
- Swissquote's service recomputes the CHF value itself (Orchestra's safety net) and never trusts the app's numbers.

## C1 Ethereum — APPROVED
Ethereum side (Base Sepolia, USDC):
- ERC-4337 smart account (Safe or Kernel; verify current SDKs before choosing).
- Custom validation module (Solidity, OpenZeppelin MerkleProof):
  - Daily payment = wallet passkey signature + Merkle proof that the recipient is an approved contact + amount within the daily limit (default 100 CHF equivalent, tracked per 24h in contract storage).
  - Only an MPC signature can call setRulebook(newRoot, newLimit).
  - Anything outside the rules (new recipient, above limit) requires the MPC key + scam shield.
- Passkey (P-256) verification via Base's native support (RIP-7212) or an established library.
- Gas sponsored by a paymaster (Swissquote pays).

## B3 Rulebook — APPROVED
The rulebook: the client's rules = approved contacts + daily limit + Spending pocket size.
- Approved contacts form a Merkle tree; only the Merkle root is stored on-chain (Ethereum smart account).
- The root and the limits can ONLY be changed with the MPC key (2 of 3 shares).
- Daily payments within the rules need only the phone (Face ID). Swissquote does NOT sign everyday payments.
Who can change the rulebook:
- phone + Swissquote: normal changes (with Swissquote's checks)
- phone + recovery provider: Swissquote down or gone
- Swissquote + recovery provider: recovery only (recovery passkey + face check + waiting period)
Pitch line: 'Swissquote signs the rulebook, not every payment.'

## A3 Scope — APPROVED
One app, many wallets (Phantom-style), assets shown side by side:
- Bitcoin (BTC) on Bitcoin signet (testnet)
- USDC on Base Sepolia (Ethereum L2 testnet)
Build order: the Bitcoin story first, end to end. Ethereum/USDC is added once Bitcoin works.
Network fees are absorbed by Swissquote on the Premium plan and paid by the client on the Standard plan; the client never needs to buy ETH.

## A4 Mocks — APPROVED
- Never implement your own cryptography. Use established open-source libraries only.
- Anything not buildable in a hackathon (bank backend, KYC/face check, sanctions provider, TEE) may be MOCKED, but every mock is labelled 'Mock' in the UI and listed in the README.
- Each mocked key-share holder (Swissquote co-signer, recovery provider) runs as a SEPARATE PROCESS with ITS OWN STORAGE. The client app must never hold their shares.
- Never fake success: show real transaction IDs and explorer links. If something fails, say so.

## E1 Payment assistant — APPROVED
Payment assistant (reuse Orchestra's chat UI + Planner):
- Client types or records a voice note: 'Send 50 USDC to my son'.
- Speech-to-text: browser speech recognition in the demo (labelled Mock of Swiss-hosted production STT).
- The LLM turns the request into a STRUCTURED draft: {recipient, amount, asset, pocket}.
- Recipient must match a saved contact; if none or ambiguous, the assistant asks ('Which son: Léo or Adam?'). The AI NEVER invents or accepts an address.
- The confirmation card is built from the structured draft, not the AI's text, and shows amount, recipient, fee.
- Rules (scam shield, rulebook) check the draft. Client taps ACCEPT (Face ID) or DECLINE.
- No message can remove the Accept/Face ID step. The assistant holds no key and sends nothing.
- Languages: EN, FR, DE, IT.

## E2 LLM — APPROVED
- Apertus (Swiss open model) via the Hugging Face router, OpenAI-compatible API, behind a single config switch (reuse Orchestra's model switch) so another model can be used as fallback.
- Rules decide, AI explains: the LLM never approves, blocks or signs anything.
- No client identity is ever sent to the LLM: only the request text, contact first names and amounts.
- Pitch/README: in production, Apertus runs in Switzerland (self-hosted or Swiss sovereign cloud).

## E3 Screens — APPROVED
1. Mock Swissquote login
2. Onboarding: Open my safe -> Face ID -> recovery key -> plan -> 'Your safe is ready'
3. Home: total in CHF; pockets side by side (BTC Spending, BTC Savings, USDC); 'Protected by Swissquote'
4. Send: pick a contact or use the assistant -> confirmation card -> Face ID
5. Receive: QR code + 'Transfer from my Swissquote account' (MOCK)
6. Contacts & rules (the rulebook): contacts, daily limit, pocket size; pending changes with countdown + Cancel
7. Alerts / activity feed with explorer links
8. Recovery: 'I lost my phone' flow with face check (MOCK) and countdown
9. Demo panel: Attacker mode, Swissquote offline, plan toggle, Demo-mode timers
Every mock labelled 'Mock'.

## E4 Look — APPROVED
Calm, bank-grade, Swiss-precise. Swissquote-inspired colours and typography, with 'Swissquote Wallet — hackathon prototype' clearly shown. Large type, generous spacing, no crypto-style neon or charts-first dashboards.

## F1 Architecture & repo — APPROVED
Fresh monorepo (TypeScript everywhere):
- apps/web: Next.js mobile-first web app (Ghaith's setup as base)
- services/cosigner: Swissquote co-signer — MPC share 2, scam shield, rulebook checks, fee service, mocked KYC/face check, Watcher (alerts). Own process, own SQLite DB.
- services/recovery-provider: share 3, 'TEE' mock, recovery passkey check, waiting period. Own process, own SQLite DB.
- contracts/: Foundry project for the rulebook validation module.
- packages/shared: types, Merkle tree helpers, API clients.
- One command starts everything (e.g. docker compose or a dev script).
Reuse from Orchestra (github.com/youssef-jeddi/Orchestra): bridge server + WebSocket approvals, approval overlay cards, Planner prompt, safety-net check, model switch, Safe helpers. Do NOT copy the agent wallet, 0G or Uniswap code.

## F2 MPC fallback — APPROVED
- Step 1 of the build is a spike: take an established open-source MPC/TSS library and sign + broadcast one Bitcoin signet transaction and one Base Sepolia transaction with a 2-of-3 key.
- Time box: 3 hours.
- If it fails: implement a 'MockMPC' service with the SAME API (keygen, sign, refresh) running as its own process, labelled 'Mock MPC' in UI and README, so everything else (rulebook, recovery, attacker mode) still works and real transactions are still sent.
- Report clearly which path was taken.

## F3 Milestones — APPROVED
M0 Spike: MPC library check (F2).
M1 Bitcoin core: create wallet (passkey + MPC keygen), Spending pocket send on signet, real txid + explorer link.
M2 Services: co-signer + recovery provider as separate processes; Savings safe MPC send; pocket refill.
M3 Recovery + attacker mode + Swissquote-offline switch. <- CORE STORY COMPLETE, freeze & test.
M4 Ethereum: smart account on Base Sepolia, rulebook validation module, paymaster, USDC.
M5 Payment assistant (voice/text) + scam shield UI + polish.
M6 README, diagrams, demo script.
Never start Mx+1 before Mx works end to end.

## F4 Deliverables & working style — APPROVED
README must include (required by the brief):
- custody model + threat model (who can steal, who can lock out, can Swissquote alone or with a partner move funds?)
- architecture diagram (Mermaid) with real vs mocked parts marked
- custody & Travel Rule section (ownership proof, Swissquote not the sending institution for client-to-third-party payments — flagged as to verify legally)
- business model (Premium/Standard plans)
- bonus topics tackled
- AI tools used and what for
- how to run, demo script
Working style:
- Start by writing a short plan and CLAUDE.md with these rules; ask before deviating from the architecture.
- Verify library versions online before installing; never invent package names.
- Tests for the rulebook contract, Merkle proofs, limits, delays and scam-shield rules.
- Commit after each milestone with a clear message.
- Clean, readable code (judged).
