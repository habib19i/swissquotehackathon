/**
 * Swissquote's own operational hot wallet: Swissquote's money, not a client's (MOCK: key in the
 * co-signer's database; an HSM in production). It pays network fees on the Premium plan and, in the
 * demo, plays the client's Swissquote account. It gives no power over any client's safe.
 */
import type { DatabaseSync } from "node:sqlite";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { nonceManager } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { buildSpend, savingsSafe, savingsSource, type Esplora, type Utxo } from "@sqw/bitcoin";

export interface HotWallet {
  address: string;
  output: Uint8Array;
  publicKey: Uint8Array;
  /** The same key on Base: relays UserOperations, signs paymaster sponsorships, receives USDC fees. */
  ethAccount: PrivateKeyAccount;
  sign(hash: Uint8Array): Uint8Array;
  /** Remembers a transaction this wallet broadcast: its change can be spent before it confirms. */
  recordOwn(txid: string): void;
  /**
   * Coins safe to spend now: confirmed, or change from our own transactions. Coins from others may
   * sit on long unconfirmed chains the network refuses to extend (signet faucets do this).
   */
  spendable(exclude?: Set<string>): Promise<{ ready: Utxo[]; waiting: Utxo[] }>;
  /** Sends `amount` sats to `to` from spendable coins; Swissquote pays the network fee. */
  send(to: string, amount: bigint, exclude?: Set<string>): Promise<string>;
}

export const coinId = (u: { txid: string; vout: number }) => `${u.txid}:${u.vout}`;

export function hotWallet(db: DatabaseSync, net: Esplora): HotWallet {
  // Historical table name: this wallet first served only the fee service.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fee_wallet (secret_key BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS hot_wallet_txs (txid TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  let row = db.prepare("SELECT secret_key FROM fee_wallet").get() as { secret_key: Uint8Array } | undefined;
  if (!row) {
    db.prepare("INSERT INTO fee_wallet (secret_key) VALUES (?)").run(secp256k1.utils.randomSecretKey());
    row = db.prepare("SELECT secret_key FROM fee_wallet").get() as { secret_key: Uint8Array };
  }
  const secretKey = new Uint8Array(row.secret_key);
  const publicKey = secp256k1.getPublicKey(secretKey, true);
  const safe = savingsSafe(publicKey); // a plain P2WPKH address
  const sign = (hash: Uint8Array) => secp256k1.sign(hash, secretKey, { prehash: false });

  const own = () =>
    new Set((db.prepare("SELECT txid FROM hot_wallet_txs").all() as { txid: string }[]).map((r) => r.txid));

  async function spendable(exclude = new Set<string>()) {
    const mine = own();
    const free = (await net.utxos(safe.address)).filter((u) => !exclude.has(coinId(u)));
    const ready = free
      .filter((u) => u.status.confirmed || mine.has(u.txid))
      .sort((a, b) => Number(b.status.confirmed) - Number(a.status.confirmed) || b.value - a.value);
    return { ready, waiting: free.filter((u) => !ready.includes(u)) };
  }

  const recordOwn = (txid: string) => {
    db.prepare("INSERT OR IGNORE INTO hot_wallet_txs (txid) VALUES (?)").run(txid);
  };

  return {
    address: safe.address,
    output: safe.output,
    publicKey,
    // Nonces are tracked in this process: the public RPC can lag behind our own last transaction.
    ethAccount: privateKeyToAccount(`0x${bytesToHex(secretKey)}`, { nonceManager }),
    sign,
    recordOwn,
    spendable,

    async send(to, amount, exclude) {
      const { ready } = await spendable(exclude);
      const spend = buildSpend({ source: savingsSource(safe), utxos: ready, to, amount, feeRate: await net.feeRate() });
      spend.psbt.signAllInputs({ publicKey, sign });
      spend.psbt.finalizeAllInputs();
      const txid = await net.broadcast(spend.psbt.extractTransaction().toHex());
      recordOwn(txid);
      return txid;
    },
  };
}
