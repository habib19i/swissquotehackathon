/**
 * Swissquote co-signer service (workstream 2). MOCK of Swissquote's backend.
 * Holds MPC share 2, runs the scam shield, enforces rulebook delays, pays fees on the Premium plan.
 * Runs as its own process with its own database (CLAUDE.md section 4).
 */
import type { NextFunction, Request, Response } from "express";
import { verifyOwnershipProof } from "@sqw/bitcoin/ownership";
import { PARTY_ID } from "@sqw/mpc";
import { MpcError, mpcRouter, peerKeysFrom, sqliteIdentity, sqliteMpcStore } from "@sqw/mpc/server";
import type { CosignRequest, RegisterWallet } from "@sqw/shared";
import { PolicyError } from "./bitcoin-policy";
import { authorizeCosign, net, ownershipMessageFor, prevoutFromNetwork, reviewSpend, useFeeWallet } from "./cosign-policy";
import { demoBank } from "./demo-bank";
import { feeService } from "./fee-service";
import { hotWallet } from "./hot-wallet";
import { btcChf } from "./price";
import { createApp, notImplemented } from "./http";
import { db } from "./db";
import { WalletError, publicRecord, walletStore } from "./wallets";

const PORT = Number(process.env.COSIGNER_PORT ?? 4001);
const RECOVERY_URL = process.env.RECOVERY_URL ?? "http://localhost:4002";
const app = createApp();
const WS2 = "workstream 2 (Swissquote Co-signer)";

const mpcStore = sqliteMpcStore(db);
const wallets = walletStore(db);
const operations = hotWallet(db, net);
const fees = feeService(db, {
  net,
  wallet: operations,
  prevout: prevoutFromNetwork,
  dailyCapSats: BigInt(process.env.FEE_SPONSOR_DAILY_CAP_SATS ?? 5_000),
});
useFeeWallet(operations.address);
const bank = demoBank(net, operations, fees.reserved);

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
    authorizeSign: (walletId, request) => {
      const wallet = wallets.get(walletId);
      if (!wallet) throw new MpcError(403, "Swissquote does not know this safe. Register it first.");
      return authorizeCosign(wallet, request as CosignRequest);
    },
    onSigned: (walletId, request) => wallets.recordCosigned(walletId, request),
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

app.get("/wallets/:walletId/rulebook", (req, res) => {
  res.json(wallets.require(req.params.walletId).rulebook);
});

app.post("/wallets/:walletId/plan", (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  wallets.setPlan(wallet.walletId, req.body?.plan);
  res.json(publicRecord(wallets.require(wallet.walletId)));
});

/** Scam shield and policy check of a Savings safe spend, shown on the confirmation card before Face ID. */
app.post("/wallets/:walletId/btc/review", async (req, res) => {
  const wallet = wallets.require(req.params.walletId);
  const { review } = await reviewSpend(wallet, req.body?.psbt, req.body?.purpose);
  res.json(review);
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

// ---------------------------------------------------------------- fee service (Premium plan)

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

// ---------------------------------------------------------------- later milestones

app.post("/wallets/:walletId/rulebook/changes", notImplemented(WS2));
app.post("/wallets/:walletId/rulebook/changes/:changeId/cancel", notImplemented(WS2));
app.post("/mock/face-check", notImplemented(WS2));

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof WalletError || err instanceof MpcError ? err.status : err instanceof PolicyError ? 403 : 500;
  res.status(status).json({ error: err.message });
});

app.listen(PORT, () => console.log(`[cosigner] MOCK Swissquote co-signer on http://localhost:${PORT}`));
