/**
 * Rulebook changes (CLAUDE.md section 6). Every change is signed with the client's MPC key (phone +
 * Swissquote). Tightening changes apply at once; loosening ones (a new contact, a higher limit) wait
 * LOOSENING_DELAY_SECONDS (24 h in production, ~30 s in demo mode), alert the client, and can be
 * cancelled from any device in the meantime. Enforced here; the app only displays it.
 */
import type { DatabaseSync } from "node:sqlite";
import { address as btcAddress } from "bitcoinjs-lib";
import { signet } from "@sqw/bitcoin";
import {
  LOOSENING_DELAY_SECONDS,
  applyChange,
  classifyChange,
  type ChangeDirection,
  type PendingChange,
  type Rulebook,
  type RulebookChange,
} from "@sqw/shared";
import type { alerts as alertsStore } from "./alerts";
import { PolicyError } from "./bitcoin-policy";
import { formatChf } from "./format";
import { MOCK_KNOWN_SCAM_ADDRESSES, MOCK_SANCTIONED_ADDRESSES } from "./shield";
import type { StoredWallet } from "./wallets";

export function describeChange(change: RulebookChange, rulebook: Rulebook): string {
  switch (change.kind) {
    case "addContact":
      return `add ${change.contact.name} as a contact`;
    case "removeContact":
      return `remove ${rulebook.contacts.find((c) => c.id === change.contactId)?.name ?? "a contact"} from your contacts`;
    case "setDailyLimit":
      return `set your daily limit to ${formatChf(change.dailyLimitChf)}`;
    case "setPocketSize":
      return `set your Spending pocket size to ${formatChf(change.pocketSizeChf)}`;
    case "freeze":
      return "freeze your safe";
    case "unfreeze":
      return "unfreeze your safe";
  }
}

interface Row {
  id: string;
  wallet_id: string;
  change: string;
  direction: ChangeDirection;
  effective_at: string;
  status: PendingChange["status"];
}

const toPending = (r: Row): PendingChange => ({
  id: r.id,
  walletId: r.wallet_id,
  change: JSON.parse(r.change),
  direction: r.direction,
  effectiveAt: r.effective_at,
  status: r.status,
});

export interface RulebookChangeDeps {
  setRulebook(walletId: string, rulebook: Rulebook): void;
  alerts: ReturnType<typeof alertsStore>;
}

export function rulebookChanges(db: DatabaseSync, { setRulebook, alerts }: RulebookChangeDeps) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rulebook_changes (
      id           TEXT PRIMARY KEY,
      wallet_id    TEXT NOT NULL,
      change       TEXT NOT NULL,
      direction    TEXT NOT NULL,
      effective_at TEXT NOT NULL,
      status       TEXT NOT NULL,
      signature    TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const pending = (walletId: string) =>
    (db.prepare("SELECT * FROM rulebook_changes WHERE wallet_id = ? AND status = 'pending' ORDER BY effective_at").all(walletId) as unknown as Row[]).map(
      toPending,
    );

  return {
    /** Swissquote's checks before the MPC key may sign a change. */
    validate(wallet: StoredWallet, change: RulebookChange) {
      const { rulebook } = wallet;
      switch (change.kind) {
        case "addContact": {
          const { contact } = change;
          if (!contact?.name?.trim() || !contact.id) throw new PolicyError("A new contact needs a name.");
          if (rulebook.contacts.some((c) => c.id === contact.id)) throw new PolicyError(`${contact.name} is already a contact.`);
          if (!contact.btcAddress) throw new PolicyError("A new contact needs a Bitcoin address.");
          try {
            btcAddress.toOutputScript(contact.btcAddress, signet);
          } catch {
            throw new PolicyError("This is not a valid Bitcoin address.");
          }
          if (MOCK_SANCTIONED_ADDRESSES.has(contact.btcAddress)) {
            throw new PolicyError("Swissquote cannot add this address: it is on a sanctions list (Mock list).");
          }
          if (MOCK_KNOWN_SCAM_ADDRESSES.has(contact.btcAddress)) {
            throw new PolicyError("Swissquote cannot add this address: it has been reported as a scam (Mock list).");
          }
          return;
        }
        case "removeContact":
          if (!rulebook.contacts.some((c) => c.id === change.contactId)) throw new PolicyError("This contact does not exist.");
          return;
        case "setDailyLimit":
        case "setPocketSize": {
          const value = change.kind === "setDailyLimit" ? change.dailyLimitChf : change.pocketSizeChf;
          if (!(value > 0 && value <= 100_000)) throw new PolicyError("Please choose an amount between CHF 1 and CHF 100,000.");
          return;
        }
      }
    },

    /** Registers a change the MPC key signed. Tightening applies now; loosening waits for the delay. */
    register(wallet: StoredWallet, change: RulebookChange, id: string, signature: string): PendingChange {
      const direction = classifyChange(wallet.rulebook, change);
      const what = describeChange(change, wallet.rulebook);
      const now = Date.now();
      const effectiveAt = new Date(direction === "loosening" ? now + LOOSENING_DELAY_SECONDS * 1000 : now).toISOString();
      const status = direction === "loosening" ? "pending" : "applied";
      db.prepare(
        "INSERT INTO rulebook_changes (id, wallet_id, change, direction, effective_at, status, signature) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(id, wallet.walletId, JSON.stringify(change), direction, effectiveAt, status, signature);

      if (direction === "tightening") {
        setRulebook(wallet.walletId, applyChange(wallet.rulebook, change));
        alerts.add({ walletId: wallet.walletId, type: "rulebook-change-applied", message: `Done: Swissquote will ${what}.`, changeId: id });
      } else {
        alerts.add({
          walletId: wallet.walletId,
          type: "rulebook-change-requested",
          message: `A request to ${what} was made. For your protection it takes effect after a waiting period. If this was not you, cancel it now from any device.`,
          changeId: id,
        });
      }
      return toPending(db.prepare("SELECT * FROM rulebook_changes WHERE id = ?").get(id) as unknown as Row);
    },

    /** Applies loosening changes whose waiting period is over. Returns the up-to-date rulebook. */
    applyDue(wallet: StoredWallet): Rulebook {
      let rulebook = wallet.rulebook;
      for (const p of pending(wallet.walletId).filter((c) => Date.parse(c.effectiveAt) <= Date.now())) {
        const what = describeChange(p.change, rulebook);
        rulebook = applyChange(rulebook, p.change);
        db.prepare("UPDATE rulebook_changes SET status = 'applied' WHERE id = ?").run(p.id);
        alerts.add({ walletId: wallet.walletId, type: "rulebook-change-applied", message: `Done: the request to ${what} is now active.`, changeId: p.id });
      }
      if (rulebook !== wallet.rulebook) setRulebook(wallet.walletId, rulebook);
      return rulebook;
    },

    cancel(wallet: StoredWallet, id: string): PendingChange {
      const row = db.prepare("SELECT * FROM rulebook_changes WHERE id = ? AND wallet_id = ?").get(id, wallet.walletId) as Row | undefined;
      if (!row) throw new PolicyError("Unknown change.");
      if (row.status === "pending") {
        db.prepare("UPDATE rulebook_changes SET status = 'cancelled' WHERE id = ?").run(id);
        const what = describeChange(JSON.parse(row.change), wallet.rulebook);
        alerts.add({ walletId: wallet.walletId, type: "rulebook-change-cancelled", message: `Cancelled: the request to ${what} will not happen.`, changeId: id });
      }
      return toPending(db.prepare("SELECT * FROM rulebook_changes WHERE id = ?").get(id) as unknown as Row);
    },

    /** Recent changes, newest first, for the rules screen and the client's other devices. */
    list(walletId: string): PendingChange[] {
      return (db.prepare("SELECT * FROM rulebook_changes WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 20").all(walletId) as unknown as Row[]).map(
        toPending,
      );
    },
  };
}
