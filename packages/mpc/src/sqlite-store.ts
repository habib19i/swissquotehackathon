/**
 * SQLite storage for a key-share holder, on the service's OWN database file (node:sqlite).
 * Mock: shares are stored unencrypted; production keeps them in an HSM / TEE.
 */
import type { DatabaseSync } from "node:sqlite";
import { newBoxKeyPair, type BoxKeyPair } from "./seal";
import type { MpcSession, MpcStore } from "./server";

export function sqliteMpcStore(db: DatabaseSync): MpcStore {
  db.exec(`
    CREATE TABLE IF NOT EXISTS key_shares (
      wallet_id  TEXT PRIMARY KEY,
      share      BLOB NOT NULL,
      public_key TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mpc_sessions (
      id         TEXT PRIMARY KEY,
      wallet_id  TEXT NOT NULL,
      next_round INTEGER NOT NULL,
      state      BLOB NOT NULL
    );
  `);

  return {
    hasShare: (walletId) => db.prepare("SELECT 1 FROM key_shares WHERE wallet_id = ?").get(walletId) !== undefined,

    saveShare: (walletId, share, publicKey) => {
      db.prepare("INSERT INTO key_shares (wallet_id, share, public_key) VALUES (?, ?, ?)").run(walletId, share, publicKey);
    },

    loadSession: (id) => {
      const row = db.prepare("SELECT wallet_id, next_round, state FROM mpc_sessions WHERE id = ?").get(id) as
        | { wallet_id: string; next_round: number; state: Uint8Array }
        | undefined;
      return row && { walletId: row.wallet_id, nextRound: row.next_round, state: new Uint8Array(row.state) };
    },

    saveSession: (id, s: MpcSession) => {
      db.prepare(
        `INSERT INTO mpc_sessions (id, wallet_id, next_round, state) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET next_round = excluded.next_round, state = excluded.state`,
      ).run(id, s.walletId, s.nextRound, s.state);
    },

    deleteSession: (id) => {
      db.prepare("DELETE FROM mpc_sessions WHERE id = ?").run(id);
    },
  };
}

/** The service's long-term box key pair for sealed protocol messages, created on first start. */
export function sqliteIdentity(db: DatabaseSync): BoxKeyPair {
  db.exec("CREATE TABLE IF NOT EXISTS identity (public_key BLOB NOT NULL, secret_key BLOB NOT NULL)");
  const row = db.prepare("SELECT public_key, secret_key FROM identity").get() as
    | { public_key: Uint8Array; secret_key: Uint8Array }
    | undefined;
  if (row) return { publicKey: new Uint8Array(row.public_key), secretKey: new Uint8Array(row.secret_key) };
  const pair = newBoxKeyPair();
  db.prepare("INSERT INTO identity (public_key, secret_key) VALUES (?, ?)").run(pair.publicKey, pair.secretKey);
  return pair;
}
