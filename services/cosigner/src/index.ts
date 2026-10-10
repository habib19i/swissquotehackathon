/**
 * Swissquote co-signer service (workstream 2). MOCK of Swissquote's backend.
 * Holds MPC share 2, runs the scam shield, enforces rulebook delays, pays fees on the Premium plan,
 * runs the (mock) face check for recoveries and the Watcher's alerts.
 * Runs as its own process with its own database (CLAUDE.md section 4).
 */
import type { NextFunction, Request, Response } from "express";
import { bytesToHex } from "@noble/hashes/utils.js";
import { verifyOwnershipProof } from "@sqw/bitcoin/ownership";
import { PARTY_ID } from "@sqw/mpc";
import { MpcError, mpcRouter, peerKeysFrom, sqliteIdentity, sqliteMpcStore } from "@sqw/mpc/server";
import { rulebookChangeDigest, type CosignRequest, type RecoveryRequest, type RegisterWallet } from "@sqw/shared";
import { alerts as alertStore } from "./alerts";
import { PolicyError } from "./bitcoin-policy";
import { authorizeCosign, net, ownershipMessageFor, prevoutFromNetwork, reviewSpend, useFeeWallet } from "./cosign-policy";
import { demoBank } from "./demo-bank";
import { faceChecks } from "./face-check";
import { feeService } from "./fee-service";
import { hotWallet } from "./hot-wallet";
import { btcChf } from "./price";
import { rulebookChanges } from "./rulebook-changes";
import { screenPayment } from "./shield";
import { createApp } from "./http";
import { db } from "./db";
import { WalletError, publicRecord, walletStore, type StoredWallet } from "./wallets";

const PORT = Number(process.env.COSIGNER_PORT ?? 4001);
const RECOVERY_URL = process.env.RECOVERY_URL ?? "http://localhost:4002";
const app = createApp();

const mpcStore = sqliteMpcStore(db);
const wallets = walletStore(db);
const alerts = alertStore(db);
const changes = rulebookChanges(db, { setRulebook: wallets.setRulebook, alerts });
const faces = faceChecks(db);
const operations = hotWallet(db, net);
const fees = feeService(db, {
  net,
  wallet: operations,
  prevout: prevoutFromNetwork,
  dailyCapSats: BigInt(process.env.FEE_SPONSOR_DAILY_CAP_SATS ?? 5_000),
});
useFeeWallet(operations.address);
const bank = demoBank(net, operations, fees.reserved);

/** A wallet with its rulebook up to date: loosening changes whose waiting period is over are applied. */
function current(walletId: string): StoredWallet {
  const wallet = wallets.require(walletId);
  return { ...wallet, rulebook: changes.applyDue(wallet) };
}

/** Asks the recovery provider directly (never through the phone) where a recovery stands. */
async function providerRecovery(recoveryId: string): Promise<(RecoveryRequest & { ready: boolean }) | undefined> {
  const res = await fetch(`${RECOVERY_URL}/recoveries/${encodeURIComponent(recoveryId)}`).catch(() => undefined);
  return res?.ok ? res.json() : undefined;
}

/** Demo: collect the mock family's test coins back every few minutes, so they keep circulating. */
const collect = () =>
  bank
    .collectFamily()
    .then((txids) => txids.length && console.log(`[cosigner] collected demo family coins: ${txids.join(", ")}`))
    .catch((err) => console.warn(`[cosigner] demo family collection failed: ${err.message}`));
setTimeout(collect, 5_000);
setInterval(collect, 10 * 60_000);

/** Demo switch for the "Swissquote is gone" scenario (CLAUDE.md section 8). */
let offline = false;

app.get("/health", (_req, res) => res.json({ service: "cosigner", mock: true, offline }));

app.post("/demo/offline", (req, res) => {
  offline = Boolean(req.body?.offline);
  res.json({ offline });
});

app.use((req, res, next) => {
  if (offline && !req.path.startsWith("/demo")) {
    return res.status(503).json({ error: "Swissquote is offline (demo switch)" });
  }
  next();
});

// ---------------------------------------------------------------- MPC share 2

// Messages to the recovery provider are sealed with its key, fetched directly from it.
app.use(
  mpcRouter({
    partyId: PARTY_ID.cosigner,
    store: mpcStore,
    identity: sqliteIdentity(db),
    peerPublicKey: peerKeysFrom({ [PARTY_ID["recovery-provider"]]: RECOVERY_URL }),

    authorizeSign: async (walletId, request) => {
      const wallet = wallets.get(walletId) && current(walletId);
      if (!wallet) throw new MpcError(403, "Swissquote does not know this safe. Register it first.");
      const req = request as CosignRequest;
      if (req.kind === "rulebook-change") {
        try {
          changes.validate(wallet, req.change);
        } catch (err) {
          throw new MpcError(403, (err as Error).message);
        }
        return rulebookChangeDigest(walletId, req.change, req.nonce);
      }
      return authorizeCosign(wallet, req);
    },

    onSigned: (walletId, request, signature) => {
      wallets.recordCosigned(walletId, request);
      const req = request as CosignRequest;
      if (req.kind === "rulebook-change") {
        changes.register(current(walletId), req.change, req.nonce, bytesToHex(signature.r) + bytesToHex(signature.s));
      }
    },

    // Swissquote + provider issue a new phone share only for a recovery the provider verified (recovery
    // key, waiting period, not cancelled) AND for which Swissquote's own face check passed.
    authorizeRecovery: async (walletId, lostPartyId, request) => {
      const { recoveryId } = (request ?? {}) as { recoveryId?: string };
      const recovery = recoveryId ? await providerRecovery(recoveryId) : undefined;
      if (lostPartyId !== PARTY_ID.phone || !recovery?.ready || recovery.walletId !== walletId) {
        throw new MpcError(403, "The recovery provider has not confirmed this recovery.");
      }
      if (!faces.passed(walletId, recovery.id)) throw new MpcError(403, "Swissquote's face check did not pass for this recovery.");
    },
  }),
);

// ---------------------------------------------------------------- wallets

app.post("/wallets", (req, res) => {
  const body = req.body as RegisterWallet;
  const wallet = wallets.register(body, mpcStore.getPublicKey(body.walletId));
  res.status(201).json(publicRecord(wallet));
});

app.get("/wallets/:walletId", (req, res) => {
  res.json(publicRecord(wallets.require(req.params.walletId)));
});

/** MOCK login lookup: a new phone, logged in to Swissquote, finds the client's safe to recover it. */
app.get("/clients/:clientNumber/wallet", (req, res) => {
  const wallet = wallets.byClient(req.params.clientNumber);
  if (!wallet) throw new WalletError(404, "This Swissquote client has no safe yet.");
  res.json(publicRecord(wallet));
});

app.post("/wallets/:walletId/plan", (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  wallets.setPlan(wallet.walletId, req.body?.plan);
  res.json(publicRecord(wallets.require(wallet.walletId)));
});

/** Scam shield and policy check of a spend, shown on the confirmation card before Face ID. */
app.post("/wallets/:walletId/btc/review", async (req, res) => {
  const wallet = current(req.params.walletId);
  const { review } = await reviewSpend(wallet, req.body?.psbt, req.body?.purpose);
  if (review.verdict === "BLOCKED") {
    alerts.add({ walletId: wallet.walletId, type: "payment-blocked", message: `Swissquote stopped a payment from your safe. ${review.reasons.join(" ")}` });
  }
  res.json(review);
});

/** Scam shield on an intended payment (recipient and amount), before any transaction is built. */
app.post("/wallets/:walletId/shield/btc", async (req, res) => {
  const wallet = current(req.params.walletId);
  const valueChf = (Number(req.body?.amountSats) / 1e8) * (await btcChf());
  const result = screenPayment({ address: String(req.body?.to), valueChf, rulebook: wallet.rulebook });
  if (result.verdict === "BLOCKED") {
    alerts.add({ walletId: wallet.walletId, type: "payment-blocked", message: `Swissquote stopped a payment from your safe. ${result.reasons.join(" ")}` });
  }
  res.json(result);
});

// ---------------------------------------------------------------- rulebook

app.get("/wallets/:walletId/rulebook", (req, res) => {
  res.json(current(req.params.walletId).rulebook);
});

app.get("/wallets/:walletId/rulebook/changes", (req, res) => {
  current(req.params.walletId);
  res.json(changes.list(req.params.walletId));
});

/** Cancel a pending loosening change, from any device the client is logged in on. */
app.post("/wallets/:walletId/rulebook/changes/:changeId/cancel", (req, res) => {
  res.json(changes.cancel(current(req.params.walletId), req.params.changeId));
});

// ---------------------------------------------------------------- ownership proof (Travel Rule)

app.post("/wallets/:walletId/ownership/challenge", (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  const issuedAt = new Date().toISOString();
  wallets.startOwnershipProof(wallet.walletId, issuedAt);
  res.json({ issuedAt });
});

app.post("/wallets/:walletId/ownership/proof", (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  const signature = String(req.body?.signature ?? "");
  if (!verifyOwnershipProof(wallet.savingsAddress, ownershipMessageFor(wallet), signature)) {
    throw new WalletError(400, "The ownership proof did not verify.");
  }
  wallets.markOwnershipVerified(wallet.walletId, signature);
  res.json(publicRecord(wallets.require(wallet.walletId)));
});

// ---------------------------------------------------------------- recovery

/** MOCK face check: the app simulates the liveness result; Swissquote signs it for the provider. */
app.get("/mock/face-check/key", (_req, res) => {
  res.json({ publicKey: faces.publicKey });
});

app.post("/mock/face-check", (req, res) => {
  const wallet = wallets.require(String(req.body?.walletId));
  const result = req.body?.simulate === "no-match" ? "no-match" : "match";
  res.json(faces.issue(wallet.walletId, String(req.body?.recoveryId), result));
});

/** After a completed recovery: the new phone's pocket replaces the old one, which stays sweepable. */
app.post("/wallets/:walletId/recovered", async (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  const recovery = await providerRecovery(String(req.body?.recoveryId));
  if (recovery?.status !== "completed" || recovery.walletId !== wallet.walletId) {
    throw new WalletError(403, "The recovery provider has not completed this recovery.");
  }
  if (req.body?.pocketPublicKey !== wallet.pocketPublicKey) wallets.replacePocket(wallet, String(req.body?.pocketPublicKey));
  res.json(publicRecord(wallets.require(wallet.walletId)));
});

// ---------------------------------------------------------------- Watcher (alerts)

/** From the recovery provider (server to server): alerts go out on every channel from Swissquote. */
app.post("/internal/alerts", (req, res) => {
  const { walletId, type, message, recoveryId } = req.body ?? {};
  wallets.require(String(walletId));
  alerts.add({ walletId, type, message, recoveryId });
  res.status(204).end();
});

app.get("/wallets/:walletId/alerts", (req, res) => {
  res.json(alerts.list(req.params.walletId, Number(req.query.after ?? 0)));
});

// ---------------------------------------------------------------- fee service (Premium plan) and demo account

/** Demo: Swissquote's operational wallet (pays Premium fees, plays the client's Swissquote account). */
app.get("/demo/account", async (_req, res) => {
  const { ready, waiting } = await operations.spendable(fees.reserved());
  const sum = (coins: { value: number }[]) => coins.reduce((s, c) => s + c.value, 0);
  res.json({ address: operations.address, ready: sum(ready), waiting: sum(waiting), dailyFeeCapSats: Number(fees.dailyCapSats) });
});

app.post("/demo/collect", async (_req, res) => {
  res.json({ txids: await bank.collectFamily() });
});

/** MOCK "Transfer from my Swissquote account": test bitcoin to the client's own registered address. */
app.post("/wallets/:walletId/demo/transfer", async (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  const into = req.body?.into === "pocket" ? "pocket" : "savings";
  res.json({ txid: await bank.transfer(wallet, Number(req.body?.amountChf), into, await btcChf()) });
});

app.post("/wallets/:walletId/fees/btc/offer", async (req, res) => {
  res.json(await fees.offer(wallets.require(req.params.walletId)));
});

app.post("/wallets/:walletId/fees/btc/sign", async (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  res.json(await fees.signAndBroadcast(wallet, String(req.body?.offerId), String(req.body?.psbt)));
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof WalletError || err instanceof MpcError ? err.status : err instanceof PolicyError ? 403 : 500;
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => console.log(`[cosigner] MOCK Swissquote co-signer on http://localhost:${PORT}`));
