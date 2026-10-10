/**
 * Swissquote's record of each client wallet, in the co-signer's own database.
 * Registration is write-once: the Spending pocket (the refill destination) cannot be redirected later,
 * except by a completed recovery, which moves the old pocket to `oldPocketKeys` so it can be swept.
 */
import type { DatabaseSync } from "node:sqlite";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { savingsSafe, spendingPocket } from "@sqw/bitcoin";
import { addColumnIfMissing } from "@sqw/mpc/server";
import { DEMO_CONTACTS, defaultRulebook, type Plan, type RegisterWallet, type Rulebook, type WalletRecord } from "@sqw/shared";

export interface StoredWallet extends WalletRecord {
  rulebook: Rulebook;
  /** Date fixed in the pending ownership proof message. */
  ownershipIssuedAt?: string;
  /** Pocket public keys replaced by recoveries (hex); their pockets can still be swept by the MPC key. */
  oldPocketKeys: string[];
}

interface Row {
  wallet_id: string;
  client_number: string;
  mpc_public_key: string;
  pocket_public_key: string;
  savings_address: string;
  pocket_address: string;
  plan: Plan;
  rulebook: string;
  ownership_issued_at: string | null;
  ownership_verified_at: string | null;
  old_pocket_keys: string | null;
}

export class WalletError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const PLANS: Plan[] = ["premium", "standard"];

export function walletStore(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wallets (
      wallet_id             TEXT PRIMARY KEY,
      client_number         TEXT NOT NULL,
      mpc_public_key        TEXT NOT NULL,
      pocket_public_key     TEXT NOT NULL,
      savings_address       TEXT NOT NULL,
      pocket_address        TEXT NOT NULL,
      plan                  TEXT NOT NULL,
      rulebook              TEXT NOT NULL,
      ownership_issued_at   TEXT,
      ownership_verified_at TEXT,
      ownership_proof       TEXT,
      created_at            TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cosigned (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id   TEXT NOT NULL,
      request     TEXT NOT NULL,
      signed_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  addColumnIfMissing(db, "wallets", "old_pocket_keys", "TEXT");

  const toWallet = (row: Row): StoredWallet => ({
    walletId: row.wallet_id,
    clientNumber: row.client_number,
    mpcPublicKey: row.mpc_public_key,
    pocketPublicKey: row.pocket_public_key,
    savingsAddress: row.savings_address,
    pocketAddress: row.pocket_address,
    plan: row.plan,
    rulebook: JSON.parse(row.rulebook),
    ownershipIssuedAt: row.ownership_issued_at ?? undefined,
    ownershipVerifiedAt: row.ownership_verified_at ?? undefined,
    oldPocketKeys: row.old_pocket_keys ? JSON.parse(row.old_pocket_keys) : [],
  });

  // MOCK contacts follow the current demo data (e.g. after the demo family's addresses changed).
  const stored = db.prepare("SELECT wallet_id, rulebook FROM wallets").all() as { wallet_id: string; rulebook: string }[];
  for (const { wallet_id, rulebook } of stored) {
    const parsed: Rulebook = JSON.parse(rulebook);
    parsed.contacts = parsed.contacts.map((c) => DEMO_CONTACTS.find((d) => d.id === c.id) ?? c);
    db.prepare("UPDATE wallets SET rulebook = ? WHERE wallet_id = ?").run(JSON.stringify(parsed), wallet_id);
  }

  function get(walletId: string): StoredWallet | undefined {
    const row = db.prepare("SELECT * FROM wallets WHERE wallet_id = ?").get(walletId) as Row | undefined;
    return row && toWallet(row);
  }

  return {
    get,

    /** MOCK login lookup: the safe of a Swissquote client, for a new phone that recovers it. */
    byClient(clientNumber: string): StoredWallet | undefined {
      const row = db.prepare("SELECT * FROM wallets WHERE client_number = ? ORDER BY created_at DESC").get(clientNumber) as Row | undefined;
      return row && toWallet(row);
    },

    require(walletId: string): StoredWallet {
      const wallet = get(walletId);
      if (!wallet) throw new WalletError(404, "Swissquote does not know this safe. Register it first.");
      return wallet;
    },

    /** Swissquote computes both addresses itself from the public keys; the app's addresses are not used. */
    register(req: RegisterWallet, mpcPublicKey: string | undefined): StoredWallet {
      if (!mpcPublicKey) throw new WalletError(404, "No key exists for this safe yet.");
      if (get(req.walletId)) throw new WalletError(409, "This safe is already registered.");
      if (!PLANS.includes(req.plan)) throw new WalletError(400, "Unknown plan.");
      try {
        secp256k1.Point.fromHex(req.pocketPublicKey);
      } catch {
        throw new WalletError(400, "Invalid Spending pocket key.");
      }

      const mpcKey = hexToBytes(mpcPublicKey);
      // MOCK: contacts imported from the client's saved beneficiaries at Swissquote.
      const rulebook: Rulebook = { ...defaultRulebook(), contacts: DEMO_CONTACTS };
      db.prepare(
        `INSERT INTO wallets (wallet_id, client_number, mpc_public_key, pocket_public_key, savings_address, pocket_address, plan, rulebook)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        req.walletId,
        req.clientNumber,
        mpcPublicKey,
        req.pocketPublicKey,
        savingsSafe(mpcKey).address,
        spendingPocket(hexToBytes(req.pocketPublicKey), mpcKey).address,
        req.plan,
        JSON.stringify(rulebook),
      );
      return get(req.walletId)!;
    },

    setRulebook(walletId: string, rulebook: Rulebook) {
      db.prepare("UPDATE wallets SET rulebook = ? WHERE wallet_id = ?").run(JSON.stringify(rulebook), walletId);
    },

    /** After a completed recovery only: the new phone's pocket replaces the old one, which stays sweepable. */
    replacePocket(wallet: StoredWallet, pocketPublicKey: string) {
      try {
        secp256k1.Point.fromHex(pocketPublicKey);
      } catch {
        throw new WalletError(400, "Invalid Spending pocket key.");
      }
      const pocket = spendingPocket(hexToBytes(pocketPublicKey), hexToBytes(wallet.mpcPublicKey));
      const old = [...wallet.oldPocketKeys, wallet.pocketPublicKey];
      db.prepare("UPDATE wallets SET pocket_public_key = ?, pocket_address = ?, old_pocket_keys = ? WHERE wallet_id = ?").run(
        pocketPublicKey,
        pocket.address,
        JSON.stringify(old),
        wallet.walletId,
      );
    },

    setPlan(walletId: string, plan: Plan) {
      if (!PLANS.includes(plan)) throw new WalletError(400, "Unknown plan.");
      db.prepare("UPDATE wallets SET plan = ? WHERE wallet_id = ?").run(plan, walletId);
    },

    startOwnershipProof(walletId: string, issuedAt: string) {
      db.prepare("UPDATE wallets SET ownership_issued_at = ? WHERE wallet_id = ?").run(issuedAt, walletId);
    },

    markOwnershipVerified(walletId: string, proof: string) {
      db.prepare("UPDATE wallets SET ownership_verified_at = ?, ownership_proof = ? WHERE wallet_id = ?").run(
        new Date().toISOString(),
        proof,
        walletId,
      );
    },

    /** Swissquote's record of everything it co-signed. */
    recordCosigned(walletId: string, request: unknown) {
      db.prepare("INSERT INTO cosigned (wallet_id, request) VALUES (?, ?)").run(walletId, JSON.stringify(request));
    },
  };
}

/** The public part of a wallet record, as returned to the app. */
export function publicRecord({ rulebook: _rulebook, ownershipIssuedAt: _issued, oldPocketKeys: _old, ...record }: StoredWallet): WalletRecord {
  return record;
}
