/**
 * Lost-phone recovery (CLAUDE.md section 8). The provider's vault acts only with a valid RECOVERY
 * passkey assertion AND Swissquote's face-check attestation, after the waiting period, and only if
 * the real client did not cancel in the meantime.
 */
import type { DatabaseSync } from "node:sqlite";
import { RECOVERY_WAIT_SECONDS, type RecoveryRequest, type RecoveryStatus } from "@sqw/shared";

/** A recovery must be verified (recovery key + face check) within this time after it starts. */
const VERIFY_WITHIN_MS = 10 * 60_000;

interface Row {
  id: string;
  wallet_id: string;
  status: RecoveryStatus;
  wait_until: string | null;
  reasons: string | null;
  created_at: string;
}

export function recoveries(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recoveries (
      id         TEXT PRIMARY KEY,
      wallet_id  TEXT NOT NULL,
      status     TEXT NOT NULL,
      wait_until TEXT,
      reasons    TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const toRequest = (r: Row): RecoveryRequest => ({
    id: r.id,
    walletId: r.wallet_id,
    status: r.status,
    waitUntil: r.wait_until ?? undefined,
    reasons: r.reasons ? JSON.parse(r.reasons) : undefined,
    createdAt: r.created_at,
  });

  /** Recoveries started but never verified in time are closed, so they stop alarming the client. */
  function expireStale() {
    db.prepare("UPDATE recoveries SET status = 'expired' WHERE status = 'awaiting-verification' AND created_at < ?").run(
      new Date(Date.now() - VERIFY_WITHIN_MS).toISOString(),
    );
  }

  function get(id: string): RecoveryRequest | undefined {
    expireStale();
    const row = db.prepare("SELECT * FROM recoveries WHERE id = ?").get(id) as Row | undefined;
    return row && toRequest(row);
  }

  function setStatus(id: string, status: RecoveryStatus, fields: { waitUntil?: string; reasons?: string[] } = {}) {
    db.prepare("UPDATE recoveries SET status = ?, wait_until = COALESCE(?, wait_until), reasons = COALESCE(?, reasons) WHERE id = ?").run(
      status,
      fields.waitUntil ?? null,
      fields.reasons ? JSON.stringify(fields.reasons) : null,
      id,
    );
    return get(id)!;
  }

  return {
    get,

    start(walletId: string): RecoveryRequest {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO recoveries (id, wallet_id, status, created_at) VALUES (?, ?, 'awaiting-verification', ?)").run(
        id,
        walletId,
        new Date().toISOString(),
      );
      return get(id)!;
    },

    /** The latest recovery of a wallet still in progress, for the client's other devices to see and cancel. */
    active(walletId: string): RecoveryRequest | undefined {
      expireStale();
      const row = db
        .prepare("SELECT * FROM recoveries WHERE wallet_id = ? AND status IN ('awaiting-verification', 'waiting-period') ORDER BY created_at DESC")
        .get(walletId) as Row | undefined;
      return row && toRequest(row);
    },

    refuse: (id: string, reasons: string[]) => setStatus(id, "refused", { reasons }),

    startWaiting: (id: string) =>
      setStatus(id, "waiting-period", { waitUntil: new Date(Date.now() + RECOVERY_WAIT_SECONDS * 1000).toISOString() }),

    cancel(id: string): RecoveryRequest {
      const recovery = get(id);
      if (!recovery) throw new Error("Unknown recovery");
      if (recovery.status !== "awaiting-verification" && recovery.status !== "waiting-period") return recovery;
      return setStatus(id, "cancelled");
    },

    complete: (id: string) => setStatus(id, "completed"),
  };
}

/** A recovery may issue a new share once verified, not cancelled, and past its waiting period. */
export function isReady(recovery: RecoveryRequest | undefined, walletId: string): boolean {
  return (
    recovery?.walletId === walletId &&
    recovery.status === "waiting-period" &&
    recovery.waitUntil !== undefined &&
    Date.parse(recovery.waitUntil) <= Date.now()
  );
}
