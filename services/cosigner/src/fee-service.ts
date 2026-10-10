/**
 * Swissquote's fee service (Premium plan): pays clients' network fees with coins from Swissquote's
 * own hot wallet. The client's coins cover exactly the amount; Swissquote's coin covers the fee, and
 * both sign the same final transaction.
 */
import type { DatabaseSync } from "node:sqlite";
import { Psbt } from "bitcoinjs-lib";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signet, type Esplora } from "@sqw/bitcoin";
import { addColumnIfMissing } from "@sqw/mpc/server";
import type { FeeOffer } from "@sqw/shared";
import { PolicyError, type Prevout } from "./bitcoin-policy";
import { checkSponsoredTx } from "./fee-sponsor";
import { coinId, type HotWallet } from "./hot-wallet";
import type { StoredWallet } from "./wallets";

/** A reserved fee coin is released if not used within this time. */
const OFFER_TTL_MS = 10 * 60_000;

export interface FeeServiceOptions {
  net: Esplora;
  wallet: HotWallet;
  /** Most Swissquote pays in fees per client per day (UTC), in satoshis. */
  dailyCapSats: bigint;
  prevout(txid: string, vout: number): Promise<Prevout>;
}

interface OfferRow {
  wallet_id: string;
  txid: string;
  vout: number;
  value: number;
  fee_rate: number;
  expires_at: number;
  used_at: string | null;
}

export function feeService(db: DatabaseSync, { net, wallet, dailyCapSats, prevout }: FeeServiceOptions) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fee_offers (
      id         TEXT PRIMARY KEY,
      wallet_id  TEXT NOT NULL,
      txid       TEXT NOT NULL,
      vout       INTEGER NOT NULL,
      value      INTEGER NOT NULL,
      fee_rate   REAL NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at    TEXT
    );
    CREATE TABLE IF NOT EXISTS fees_paid (
      wallet_id TEXT NOT NULL,
      sats      INTEGER NOT NULL,
      paid_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  addColumnIfMissing(db, "fee_offers", "broadcast_txid", "TEXT");
  // Sponsored transactions recorded before the hot wallet kept its own list.
  for (const { broadcast_txid } of db.prepare("SELECT broadcast_txid FROM fee_offers WHERE broadcast_txid IS NOT NULL").all() as {
    broadcast_txid: string;
  }[]) {
    wallet.recordOwn(broadcast_txid);
  }

  const paidToday = (walletId: string) =>
    BigInt(
      (db.prepare("SELECT COALESCE(SUM(sats), 0) AS s FROM fees_paid WHERE wallet_id = ? AND paid_at >= date('now')").get(walletId) as {
        s: number;
      }).s,
    );

  /** Coins promised to a payment: reserved, or used and maybe not yet out of the network's index. */
  function reserved(): Set<string> {
    const rows = db.prepare("SELECT txid, vout FROM fee_offers WHERE used_at IS NOT NULL OR expires_at > ?").all(Date.now());
    return new Set((rows as { txid: string; vout: number }[]).map(coinId));
  }

  return {
    reserved,
    dailyCapSats,

    async offer(client: StoredWallet): Promise<FeeOffer> {
      if (client.plan !== "premium") return { sponsored: false, reason: "On the Standard plan, you pay the network fee." };
      if (paidToday(client.walletId) >= dailyCapSats) {
        return { sponsored: false, reason: "You have reached today's limit of network fees paid by Swissquote." };
      }
      // A client needs one open offer at a time: a new request releases its unused earlier one.
      db.prepare("DELETE FROM fee_offers WHERE wallet_id = ? AND used_at IS NULL").run(client.walletId);
      const { ready, waiting } = await wallet.spendable(reserved());
      if (ready.length === 0) {
        return {
          sponsored: false,
          reason:
            waiting.length > 0
              ? "Swissquote's fee coins are waiting for the network to confirm them, so you pay the fee this time."
              : "Swissquote's fee service is out of test coins right now.",
        };
      }

      const [coin] = ready;
      const offerId = crypto.randomUUID();
      const feeRate = await net.feeRate();
      db.prepare("INSERT INTO fee_offers (id, wallet_id, txid, vout, value, fee_rate, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        offerId,
        client.walletId,
        coin.txid,
        coin.vout,
        coin.value,
        feeRate,
        Date.now() + OFFER_TTL_MS,
      );
      return {
        sponsored: true,
        offerId,
        coin: { txid: coin.txid, vout: coin.vout, value: coin.value },
        output: bytesToHex(wallet.output),
        changeAddress: wallet.address,
        feeRate,
      };
    },

    /**
     * Checks the final transaction, signs Swissquote's fee coin in it and broadcasts it. The fee only
     * counts as paid once the network accepted the transaction; on refusal the coin is released.
     */
    async signAndBroadcast(client: StoredWallet, offerId: string, psbtBase64: string): Promise<{ txid: string; psbt: string }> {
      const offer = db.prepare("SELECT * FROM fee_offers WHERE id = ?").get(offerId) as OfferRow | undefined;
      if (!offer || offer.wallet_id !== client.walletId) throw new PolicyError("Unknown fee offer.");
      if (offer.used_at) throw new PolicyError("This fee offer was already used.");
      if (offer.expires_at < Date.now()) throw new PolicyError("This fee offer has expired. Please start again.");

      const psbt = Psbt.fromBase64(psbtBase64, { network: signet });
      const { inputIndex, sponsorPays } = await checkSponsoredTx(
        psbt,
        { coin: { txid: offer.txid, vout: offer.vout, value: offer.value }, output: wallet.output, feeRate: offer.fee_rate },
        { prevout, paidToday: paidToday(client.walletId), dailyCap: dailyCapSats },
      );

      // Claim the offer before any await, so one offer pays one fee only.
      const claimed = db.prepare("UPDATE fee_offers SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL").run(offerId);
      if (claimed.changes !== 1) throw new PolicyError("This fee offer was already used.");
      try {
        psbt.signInput(inputIndex, { publicKey: wallet.publicKey, sign: wallet.sign });
        psbt.finalizeInput(inputIndex);
        const txid = await net.broadcast(psbt.extractTransaction().toHex());
        wallet.recordOwn(txid);
        db.prepare("UPDATE fee_offers SET broadcast_txid = ? WHERE id = ?").run(txid, offerId);
        db.prepare("INSERT INTO fees_paid (wallet_id, sats) VALUES (?, ?)").run(client.walletId, Number(sponsorPays));
        return { txid, psbt: psbt.toBase64() };
      } catch (err) {
        db.prepare("UPDATE fee_offers SET used_at = NULL WHERE id = ?").run(offerId);
        throw new PolicyError((err as Error).message);
      }
    },
  };
}
