/**
 * "Swissquote gone" (CLAUDE.md section 8): the phone and the recovery provider can still move the
 * client's Savings safe, to any address the client chooses. The provider co-signs only when it sees
 * for itself that Swissquote is down, and only a transaction the client approved with the RECOVERY key,
 * so a thief holding the phone cannot use an outage to empty the safe.
 */
import type { DatabaseSync } from "node:sqlite";
import { Psbt, Transaction, address as btcAddress } from "bitcoinjs-lib";
import { equalBytes } from "@noble/curves/utils.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { inputSighash, savingsSafe, signet, type Esplora } from "@sqw/bitcoin";
import { MpcError } from "@sqw/mpc/server";

/** Above this, the network fee is treated as a mistake or an attack. */
const MAX_FEE_SATS = 20_000n;
const APPROVAL_TTL_MS = 5 * 60_000;

/** True when Swissquote's co-signer reports itself offline or cannot be reached. */
export async function swissquoteIsOffline(cosignerUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${cosignerUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    return Boolean((await res.json()).offline);
  } catch {
    return true;
  }
}

export function unsignedTxid(psbtBase64: string): string {
  return Transaction.fromBuffer(Psbt.fromBase64(psbtBase64, { network: signet }).data.getTransaction()).getId();
}

export function offlineApprovals(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS offline_approvals (
      token      TEXT PRIMARY KEY,
      wallet_id  TEXT NOT NULL,
      txid       TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);
  return {
    /** Records that the client approved transaction `txid` with the recovery key. */
    grant(walletId: string, txid: string): string {
      const token = crypto.randomUUID();
      db.prepare("INSERT INTO offline_approvals (token, wallet_id, txid, expires_at) VALUES (?, ?, ?, ?)").run(
        token,
        walletId,
        txid,
        Date.now() + APPROVAL_TTL_MS,
      );
      return token;
    },
    covers(token: string, walletId: string, txid: string): boolean {
      const row = db.prepare("SELECT wallet_id, txid, expires_at FROM offline_approvals WHERE token = ?").get(token) as
        | { wallet_id: string; txid: string; expires_at: number }
        | undefined;
      return row !== undefined && row.wallet_id === walletId && row.txid === txid && row.expires_at > Date.now();
    },
  };
}

export interface OfflineSignRequest {
  kind: "btc-input";
  psbt: string;
  inputIndex: number;
  approvalToken?: string;
}

/** The provider's own check of a Savings safe spend while Swissquote is down; returns the digest. */
export async function offlineDigest(
  request: OfflineSignRequest,
  mpcPublicKey: Uint8Array,
  net: Esplora,
): Promise<Uint8Array> {
  const psbt = Psbt.fromBase64(request.psbt, { network: signet });
  const tx = Transaction.fromBuffer(psbt.data.getTransaction());
  const savingsScript = savingsSafe(mpcPublicKey).output;

  let inputsTotal = 0n;
  for (const input of tx.ins) {
    const out = (await net.tx(bytesToHex(Uint8Array.from(input.hash).reverse())).catch(() => undefined))?.vout[input.index];
    if (!out || !equalBytes(hexToBytes(out.scriptpubkey), savingsScript)) {
      throw new MpcError(403, "Only coins in your Savings safe can be moved this way.");
    }
    inputsTotal += BigInt(out.value);
  }
  const fee = inputsTotal - tx.outs.reduce((sum, o) => sum + o.value, 0n);
  if (fee < 0n || fee > MAX_FEE_SATS) throw new MpcError(403, "The network fee of this transaction is not acceptable.");
  tx.outs.forEach((o) => btcAddress.fromOutputScript(o.script, signet)); // every output must be a valid address

  const prevout = await net.tx(bytesToHex(Uint8Array.from(tx.ins[request.inputIndex].hash).reverse()));
  const value = BigInt(prevout.vout[tx.ins[request.inputIndex].index].value);
  return inputSighash(tx, request.inputIndex, mpcPublicKey, value);
}
