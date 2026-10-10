/**
 * Independent recovery provider (workstream 4). MOCK of a TEE-backed provider.
 * Holds MPC share 3 and acts only with a valid RECOVERY passkey assertion
 * AND Swissquote's face-check attestation, after the waiting period (CLAUDE.md section 8).
 * Runs as its own process with its own database (CLAUDE.md section 4).
 */
import type { NextFunction, Request, Response } from "express";
import { hexToBytes } from "@noble/hashes/utils.js";
import { esplora } from "@sqw/bitcoin";
import { PARTY_ID } from "@sqw/mpc";
import { MpcError, mpcRouter, peerKeysFrom, sqliteIdentity, sqliteMpcStore } from "@sqw/mpc/server";
import type { AlertType, FaceCheckAttestation, RecoveryKeyKind } from "@sqw/shared";
import { checkFaceAttestation } from "./face-check";
import { createApp } from "./http";
import { db } from "./db";
import { offlineApprovals, offlineDigest, swissquoteIsOffline, unsignedTxid, type OfflineSignRequest } from "./offline";
import { isReady, recoveries } from "./recoveries";
import { RecoveryKeyError, recoveryKeys } from "./recovery-keys";

const PORT = Number(process.env.RECOVERY_PORT ?? 4002);
const COSIGNER_URL = process.env.COSIGNER_URL ?? "http://localhost:4001";
const app = createApp();
const net = esplora(process.env.BITCOIN_ESPLORA_URL);

const store = sqliteMpcStore(db);
const keys = recoveryKeys(db);
const recovery = recoveries(db);
const approvals = offlineApprovals(db);

/** The Watcher lives at Swissquote: alerts go out on every channel from there (mocked on screen). */
function alert(walletId: string, type: AlertType, message: string, recoveryId?: string) {
  fetch(`${COSIGNER_URL}/internal/alerts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletId, type, message, recoveryId }),
  }).catch(() => console.warn(`[recovery-provider] could not reach Swissquote to send alert: ${message}`));
}

app.get("/health", (_req, res) => res.json({ service: "recovery-provider", mock: true, tee: "mocked" }));

// ---------------------------------------------------------------- MPC share 3

app.use(
  mpcRouter({
    partyId: PARTY_ID["recovery-provider"],
    store,
    identity: sqliteIdentity(db),
    peerPublicKey: peerKeysFrom({ [PARTY_ID.cosigner]: COSIGNER_URL }),

    // Swissquote gone: phone + provider, only with the client's recovery-key approval of this transaction.
    authorizeSign: async (walletId, request) => {
      const req = request as OfflineSignRequest;
      if (req?.kind !== "btc-input") throw new MpcError(403, "The recovery provider does not sign this kind of request.");
      if (!(await swissquoteIsOffline(COSIGNER_URL))) {
        throw new MpcError(403, "Swissquote is available: the recovery provider only co-signs when Swissquote is gone.");
      }
      if (!req.approvalToken || !approvals.covers(req.approvalToken, walletId, unsignedTxid(req.psbt))) {
        throw new MpcError(403, "This payment was not approved with your recovery key.");
      }
      return offlineDigest(req, hexToBytes(store.getPublicKey(walletId)!), net);
    },

    // Recovery: only a verified, uncancelled recovery past its waiting period may issue a new phone share.
    authorizeRecovery: async (walletId, lostPartyId, request) => {
      const { recoveryId } = (request ?? {}) as { recoveryId?: string };
      if (lostPartyId !== PARTY_ID.phone || !isReady(recovery.get(String(recoveryId)), walletId)) {
        throw new MpcError(403, "This recovery is not verified, was cancelled, or is still in its waiting period.");
      }
    },
    onRecovered: (walletId, request) => {
      const { recoveryId } = request as { recoveryId: string };
      recovery.complete(recoveryId);
      alert(walletId, "recovery-completed", "Your safe was moved to your new phone. Your old phone can no longer use it.", recoveryId);
    },
  }),
);

// ---------------------------------------------------------------- recovery key

const requireShare = (walletId: string) => {
  if (!store.hasShare(walletId)) throw new RecoveryKeyError(404, "The recovery provider does not know this safe.");
};

app.post("/wallets/:walletId/recovery-key/options", async (req, res) => {
  requireShare(req.params.walletId);
  const kind: RecoveryKeyKind = req.body?.kind === "synced" ? "synced" : "security-key";
  res.json(await keys.registrationOptions(req.params.walletId, String(req.body?.clientNumber), kind));
});

app.post("/wallets/:walletId/recovery-key", async (req, res) => {
  requireShare(req.params.walletId);
  const kind = await keys.register(req.params.walletId, String(req.body?.requestId), req.body?.response);
  res.status(201).json({ registered: true, kind });
});

app.get("/wallets/:walletId/recovery-key", (req, res) => {
  const kind = keys.kindOf(req.params.walletId);
  res.json({ registered: kind !== undefined, kind });
});

// ---------------------------------------------------------------- recovery

app.post("/wallets/:walletId/recoveries", async (req, res) => {
  const walletId = req.params.walletId;
  requireShare(walletId);
  const started = recovery.start(walletId);
  const { requestId, options } = await keys.assertionOptions(walletId, "recovery", { recoveryId: started.id });
  res.status(201).json({ recovery: started, requestId, options });
});

app.post("/recoveries/:recoveryId/verify", async (req, res) => {
  const current = recovery.get(req.params.recoveryId);
  if (!current) throw new RecoveryKeyError(404, "Unknown recovery.");
  if (current.status !== "awaiting-verification") return res.json(current);

  const reasons: string[] = [];
  const assertion = req.body?.assertion;
  const keyContext = assertion
    ? await keys.verifyAssertion(current.walletId, String(req.body?.requestId), "recovery", assertion).catch(() => undefined)
    : undefined;
  if (!assertion) {
    reasons.push("The recovery key was not presented. Without the client's own recovery key, nobody can take over this safe.");
  } else if ((keyContext as { recoveryId?: string } | undefined)?.recoveryId !== current.id) {
    reasons.push("This is not the recovery key registered for this safe.");
  }
  reasons.push(
    ...(await checkFaceAttestation(COSIGNER_URL, req.body?.faceCheck as FaceCheckAttestation | undefined, current.walletId, current.id)),
  );

  if (reasons.length > 0) {
    alert(current.walletId, "recovery-refused", `Someone tried to move your safe to a new phone and was refused. ${reasons.join(" ")}`, current.id);
    return res.json(recovery.refuse(current.id, reasons));
  }
  const waiting = recovery.startWaiting(current.id);
  alert(
    current.walletId,
    "recovery-started",
    "Your safe is being moved to a new phone. If this is not you, cancel it now from any device.",
    current.id,
  );
  res.json(waiting);
});

app.post("/recoveries/:recoveryId/cancel", (req, res) => {
  const cancelled = recovery.cancel(req.params.recoveryId);
  if (cancelled.status === "cancelled") {
    alert(cancelled.walletId, "recovery-cancelled", "The move of your safe to a new phone was cancelled.", cancelled.id);
  }
  res.json(cancelled);
});

app.get("/recoveries/:recoveryId", (req, res) => {
  const found = recovery.get(req.params.recoveryId);
  if (!found) throw new RecoveryKeyError(404, "Unknown recovery.");
  res.json({ ...found, ready: isReady(found, found.walletId) });
});

app.get("/wallets/:walletId/recoveries/active", (req, res) => {
  res.json(recovery.active(req.params.walletId) ?? null);
});

// ---------------------------------------------------------------- Swissquote gone

app.post("/wallets/:walletId/offline-approval", async (req, res) => {
  requireShare(req.params.walletId);
  if (!(await swissquoteIsOffline(COSIGNER_URL))) {
    throw new RecoveryKeyError(409, "Swissquote is available: use it for this payment.");
  }
  res.json(await keys.assertionOptions(req.params.walletId, "offline-approval", { txid: String(req.body?.txid) }));
});

app.post("/wallets/:walletId/offline-approval/verify", async (req, res) => {
  const walletId = req.params.walletId;
  const context = await keys.verifyAssertion(walletId, String(req.body?.requestId), "offline-approval", req.body?.assertion);
  const txid = (context as { txid?: string } | undefined)?.txid;
  if (!txid) throw new RecoveryKeyError(403, "Your recovery key did not approve this payment.");
  res.json({ approvalToken: approvals.grant(walletId, txid) });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof RecoveryKeyError || err instanceof MpcError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => console.log(`[recovery-provider] MOCK recovery provider (TEE mock) on http://localhost:${PORT}`));
