/**
 * Independent recovery provider (workstream 4). MOCK of a TEE-backed provider.
 * Holds MPC share 3 and acts only with a valid RECOVERY passkey assertion
 * AND Swissquote's face-check attestation, after the waiting period (CLAUDE.md section 8).
 * Runs as its own process with its own database (CLAUDE.md section 4).
 */
import { PARTY_ID } from "@sqw/mpc";
import { mpcRouter, peerKeysFrom, sqliteIdentity, sqliteMpcStore } from "@sqw/mpc/server";
import { createApp, notImplemented } from "./http";
import { db } from "./db";

const PORT = Number(process.env.RECOVERY_PORT ?? 4002);
const COSIGNER_URL = process.env.COSIGNER_URL ?? "http://localhost:4001";
const app = createApp();
const WS4 = "workstream 4 (Recovery & Attacker Mode)";

app.get("/health", (_req, res) => res.json({ service: "recovery-provider", mock: true, tee: "mocked" }));

// MPC share 3. Messages to Swissquote are sealed with its key, fetched directly from it.
app.use(
  mpcRouter({
    partyId: PARTY_ID["recovery-provider"],
    store: sqliteMpcStore(db),
    identity: sqliteIdentity(db),
    peerPublicKey: peerKeysFrom({ [PARTY_ID.cosigner]: COSIGNER_URL }),
  }),
);

app.post("/wallets/:walletId/recovery-passkey", notImplemented(WS4));
app.post("/wallets/:walletId/recoveries", notImplemented(WS4));
app.post("/recoveries/:recoveryId/verify", notImplemented(WS4));
app.post("/recoveries/:recoveryId/cancel", notImplemented(WS4));
app.get("/recoveries/:recoveryId", notImplemented(WS4));
app.post("/recoveries/:recoveryId/complete", notImplemented(WS4));

app.listen(PORT, () => console.log(`[recovery-provider] MOCK recovery provider (TEE mock) on http://localhost:${PORT}`));
