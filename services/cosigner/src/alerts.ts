/**
 * The Watcher (CLAUDE.md section 9): alerts to the client "on every channel". In the prototype the
 * channels are mocked: the app and the mock e-banking page poll them from here.
 */
import type { DatabaseSync } from "node:sqlite";
import type { Alert, AlertType } from "@sqw/shared";

interface Row {
  id: number;
  wallet_id: string;
  type: AlertType;
  message: string;
  change_id: string | null;
  recovery_id: string | null;
  at: string;
}

export function alerts(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wallet_id   TEXT NOT NULL,
      type        TEXT NOT NULL,
      message     TEXT NOT NULL,
      change_id   TEXT,
      recovery_id TEXT,
      at          TEXT NOT NULL
    );
  `);

  return {
    add(a: Omit<Alert, "id" | "at">) {
      db.prepare("INSERT INTO alerts (wallet_id, type, message, change_id, recovery_id, at) VALUES (?, ?, ?, ?, ?, ?)").run(
        a.walletId,
        a.type,
        a.message,
        a.changeId ?? null,
        a.recoveryId ?? null,
        new Date().toISOString(),
      );
    },

    /** Newest first; `after` returns only alerts newer than that id. */
    list(walletId: string, after = 0): Alert[] {
      const rows = db.prepare("SELECT * FROM alerts WHERE wallet_id = ? AND id > ? ORDER BY id DESC LIMIT 50").all(walletId, after) as unknown as Row[];
      return rows.map((r) => ({
        id: r.id,
        walletId: r.wallet_id,
        type: r.type,
        message: r.message,
        at: r.at,
        changeId: r.change_id ?? undefined,
        recoveryId: r.recovery_id ?? undefined,
      }));
    },
  };
}
