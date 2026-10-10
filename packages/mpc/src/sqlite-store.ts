/**
 * SQLite storage for a key-share holder, on the service's OWN database file (node:sqlite).
 * Mock: shares are stored unencrypted; production keeps them in an HSM / TEE.
 */
import type { DatabaseSync } from "node:sqlite";
import { newBoxKeyPair, type BoxKeyPair } from "./seal";
import type { MpcSession, MpcStore } from "./server";

/** Adds a column to an existing table, so databases created by earlier versions keep working. */
export function addColumnIfMissing(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

interface SessionRow {
  wallet_id: string;
  kind: MpcSession["kind"];
  next_round: number;
  state: Uint8Array;
  digest: string | null;
  request: string | null;
}

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
  addColumnIfMissing(db, "mpc_sessions", "kind", "TEXT NOT NULL DEFAULT 'keygen'");
  addColumnIfMissing(db, "mpc_sessions", "digest", "TEXT");
  addColumnIfMissing(db, "mpc_sessions", "request", "TEXT");

  const shareRow = (walletId: string) =>
    db.prepare("SELECT share, public_key FROM key_shares WHERE wallet_id = ?").get(walletId) as
      | { share: Uint8Array; public_key: string }
      | undefined;

  return {
    hasShare: (walletId) => shareRow(walletId) !== undefined,

    getShare: (walletId) => {
      const row = shareRow(walletId);
      return row && new Uint8Array(row.share);
    },

    getPublicKey: (walletId) => shareRow(walletId)?.public_key,

    saveShare: (walletId, share, publicKey) => {
      db.prepare("INSERT INTO key_shares (wallet_id, share, public_key) VALUES (?, ?, ?)").run(walletId, share, publicKey);
    },

    replaceShare: (walletId, share, publicKey) => {
      const updated = db
        .prepare("UPDATE key_shares SET share = ?, public_key = ?, created_at = datetime('now') WHERE wallet_id = ?")
        .run(share, publicKey, walletId);
      if (updated.changes !== 1) throw new Error("No share to replace");
    },

    loadSession: (id) => {
      const row = db
        .prepare("SELECT wallet_id, kind, next_round, state, digest, request FROM mpc_sessions WHERE id = ?")
        .get(id) as SessionRow | undefined;
      return (
        row && {
          walletId: row.wallet_id,
          kind: row.kind,
          nextRound: row.next_round,
          state: new Uint8Array(row.state),
          digest: row.digest ?? undefined,
          request: row.request ? JSON.parse(row.request) : undefined,
        }
      );
    },

    saveSession: (id, s: MpcSession) => {
      db.prepare(
        `INSERT INTO mpc_sessions (id, wallet_id, kind, next_round, state, digest, request) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET next_round = excluded.next_round, state = excluded.state`,
      ).run(id, s.walletId, s.kind, s.nextRound, s.state, s.digest ?? null, s.request ? JSON.stringify(s.request) : null);
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
