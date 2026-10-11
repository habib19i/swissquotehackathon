# Demo script: about 8 minutes, five acts

The core story, live on testnets: **open a safe, pay, survive a thief, survive Swissquote going away, lose the
phone and get everything back.** Every payment shown is a real transaction with an explorer link.

Pitch line to repeat: **"Swissquote signs the rulebook, not every payment."**

## Before the demo

The day before (test coins need time):

- [ ] `pnpm dev` runs the web app (3000), the co-signer (4001) and the recovery provider (4002).
- [ ] **Plan and settings** → Swissquote demo account:
  - **bitcoin:** at least CHF 300 *ready* (signet faucet to the address shown; faucet coins need a block);
  - **test USDC:** at least USDC 20 (faucet.circle.com, network Base Sepolia, to the Base address shown);
  - **gas deposit:** at least 0.005 ETH (`pnpm --filter @sqw/cosigner fund:paymaster` if lower).
- [ ] The assistant answers (`LLM_API_KEY` in `.env`): try "Send 2 USDC to my son" once.
- [ ] For the bonus act: `NEXT_PUBLIC_REOWN_PROJECT_ID` in `.env`, and app.aave.com open in another tab with
      testnet mode on and the Base Sepolia market selected.
- [ ] Demo timers in `.env`: `LOOSENING_DELAY_SECONDS=30`, `RECOVERY_WAIT_SECONDS=60`.

Just before:

- [ ] Window **A**, "the phone": Chrome or Edge at http://localhost:3000. Use a **client number never used
      before** (for example `CH-4417-3001`), so the app opens a new safe.
- [ ] Window **B**, "the new phone": an Incognito window, for Act 5.
- [ ] Tab **C**, "the client's other device": http://localhost:3000/e-banking, logged in with the same client number.
- [ ] The recovery key at hand: the security key, or the passkey option chosen in Act 1.
- [ ] Plan set to **Premium** (Swissquote pays the network fees), unless showing Standard.

## Act 1: open a safe (1:30)

1. **Log in to your Swissquote account** with the client number. *"Elisabeth is already a Swissquote client,
   identity verified. Nothing to fill in."* (Mock login.)
2. **Open my safe** → **Lock it with your face** (Face ID). *"Face ID is the only password. No seed phrase,
   nothing to write down."*
3. *Creating your safe*: the three key holders light up. *"One key, created in three pieces: this phone,
   Swissquote, and an independent safe-keeper. Any two can sign. Swissquote alone never can."*
4. *Swissquote is checking your safe*: *"The safe signs a message binding it to her client number, on Bitcoin
   and on Base. That is our Travel Rule proof: no whitelist, no screenshots."*
5. **Add your recovery key** → **Security key from Swissquote** (or the passkey option, with its warning).
6. **Choose your plan** → Premium → **Your safe is ready**.
7. **Receive** → **Transfer from my Swissquote account**: CHF 100 to the **Spending pocket**, CHF 200 to the
   **Savings safe**, then **USDC** → CHF 15. (Mock Swissquote account, real test coins.)

## Act 2: pay like Twint (1:30)

1. **Send** → Léo → **Bitcoin** → CHF 20 → the card: *from the Spending pocket, network fee paid by Swissquote*.
   **Confirm with Face ID**. *"Swissquote did not sign this payment. The phone did, alone."* Open the link.
2. **Ask the assistant**: *"Send 2 USDC to my son."* It asks **"Which son: Léo or Adam?"** → "Léo".
   The card: *Face ID only, Léo is an approved contact, within the daily limit; the account on Base checks
   both itself.* **Confirm with Face ID** → arrived within seconds. *"The AI drafts, the rules decide, she
   confirms. The model never sees who she is and never touches an address."*
3. Optional, the Savings safe: **Send** → Sofia → Bitcoin → CHF 150 → **Pay from my Savings safe** →
   *Swissquote asks you to check: above your daily limit* → **Yes, I want to make this payment** → Face ID.
   *"Larger amounts need Swissquote's check. That is the scam shield."*

## Act 3: a thief has her unlocked phone and her email (1:30)

**Demo panel** → **Attacker mode** → **Try it** on each line:

1. **Send CHF 5,000 to himself**: *Stopped*: Swissquote blocks large payments to someone never paid, in
   bitcoin and in USDC.
2. **Add himself as a contact**: *On hold* for 24 hours (demo: 30 s), and the client is alerted everywhere.
   Switch to tab **C** (e-banking), **cancel** the request → back in A: *Stopped*.
3. **Take whatever the rules allow**: the Spending pocket (never more than CHF 100) and payments to the
   family within the daily limit. *"That is the worst case: a phone's worth, not a safe's worth."*
4. **Move the safe to his own phone**: *Refused*: no recovery key, and the face check failed.

## Act 4: Swissquote is gone (1:00)

1. **Demo panel** → **Swissquote offline** → **Switch off**. Home says Swissquote is offline.
2. **Send** → Léo → Bitcoin → CHF 10 from the Spending pocket: works as usual, phone only.
3. **Send** → Adam → Bitcoin → CHF 120 → **Pay from my Savings safe**: Face ID, then the **recovery key**
   approves this exact payment, and the independent safe-keeper co-signs instead of Swissquote.
   *"If Swissquote disappeared tomorrow, she still moves everything, with her own keys."*
4. **Bring back** Swissquote. (USDC payments wait while Swissquote is offline: in this prototype
   Swissquote relays them to Base. Say it if asked.)

## Act 5: lose the phone, get everything back (2:00)

1. **Demo panel** → **Lose this phone** → **Yes, delete it from this phone**. The phone's key piece is gone.
2. Window **B** (the new phone): **Log in** with the same client number → **I lost my phone** →
   **Bring your safe to this phone**.
3. **Lock this phone with your face** (a new Face ID key) → **Use my recovery key** → **Start the face check**
   (Mock liveness).
4. The waiting period starts (48 hours; demo: 60 s). Show tab **C**: the alert, and the real client could
   cancel here. *"If this were a thief, she would see it everywhere and stop it."*
5. **Bring my safe back** → **Your safe is back**: same Savings safe address, the old Spending pocket moved to
   the new one, and *"Your USDC now answer to this phone's Face ID"*: the lost phone's Face ID no
   longer works on Base. Home shows the same balances. *"The key never left the safe-keeper's vault; the old
   piece is now useless."*

Close: *"Self-custody that feels like Twint, with Swissquote's protection at every step. And Swissquote can
never take the money: it signs the rulebook, not every payment."*

## Bonus: DeFi, protected by Swissquote (1:30, if time allows)

After Act 2 (the safe needs a little USDC):

1. **Assistant**: "Exchange 1 USDC for ETH". The card shows what goes in, what comes back (to your own safe)
   and Swissquote's check; confirm, Face ID. *"Swissquote vets which apps you can use: no scam tokens."*
2. **Assistant**: "Approve Aave" → **Approve Aave with Face ID**. The waiting period starts, with alerts, like a
   new contact. *"Approve an app once, and Face ID is enough, within a daily limit the account enforces."*
3. After the waiting period: **Explore → Aave** → deposit all the ETH. Face ID alone; show the explorer link.
4. **WalletConnect**: on app.aave.com, Connect wallet → WalletConnect → copy the link; in the wallet, Explore →
   **Scan an app's QR code** → paste → **Connect**. Withdraw from Aave's website: each request arrives as a card
   with Swissquote's check, then Face ID, and the website gets the real transaction hash.

Say plainly if asked: Uniswap's own website cannot connect on Base Sepolia (it does not support that network);
Uniswap works from Explore and the assistant.

## If something goes wrong

| Symptom | What to do |
|---|---|
| "The network has not confirmed this yet" (bitcoin) | Use coins from Swissquote's transfer (they are confirmed), or pay from the other pocket; a block comes every ~10 minutes. |
| A USDC payment says the network refused | Retry once: Base's public RPC can lag a few seconds behind. |
| The assistant cannot be reached | It says why (quota, network). Use **Send** instead; the same card follows. |
| Face ID does not appear | Use http://localhost or https: passkeys need a secure origin. |
| "You already have a safe" in Act 1 | That client number was used before: pick a new one, or use **Bring my safe to this phone** to show recovery. |
| Stuck with Swissquote offline | Demo panel → **Bring back**, then reload. |
| "Face ID key is a type Base cannot check" | The safe got an RSA passkey (older Windows Hello safes): open a new safe. |
| Explore says the safe was opened before apps | Open a new safe: older safes keep working but cannot use apps. |
| A website's connection card says it does not offer Base Sepolia | That website does not support the test network (for example app.uniswap.org): use Explore instead. |
