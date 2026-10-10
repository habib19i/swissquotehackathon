"use client";

import { useCallback, useEffect, useState } from "react";
import type { Alert, PendingChange, RecoveryRequest, Rulebook } from "@sqw/shared";
import { cosigner } from "../lib/cosigner";
import { provider } from "../lib/provider";
import { Countdown, DemoModeNote } from "./countdown";

const when = new Intl.DateTimeFormat("en-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function describe(change: PendingChange["change"], rulebook?: Rulebook): string {
  switch (change.kind) {
    case "addContact":
      return `Add ${change.contact.name} as a contact`;
    case "removeContact":
      return `Remove ${rulebook?.contacts.find((c) => c.id === change.contactId)?.name ?? "a contact"}`;
    case "setDailyLimit":
      return `Daily limit to CHF ${change.dailyLimitChf}`;
    case "setPocketSize":
      return `Spending pocket size to CHF ${change.pocketSizeChf}`;
    case "freeze":
      return "Freeze the safe";
    case "unfreeze":
      return "Unfreeze the safe";
  }
}

/**
 * What the Watcher told the client, with the actions it allows: cancel a pending loosening change,
 * or cancel a recovery during its waiting period. Polls every few seconds.
 */
export function AlertsFeed({ walletId }: { walletId: string }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [recovery, setRecovery] = useState<RecoveryRequest | null>(null);
  const [rulebook, setRulebook] = useState<Rulebook>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [a, changes, active, rb] = await Promise.all([
        cosigner.alerts(walletId),
        cosigner.changes(walletId),
        provider.activeRecovery(walletId).catch(() => null),
        cosigner.rulebook(walletId),
      ]);
      setAlerts(a);
      setPending(changes.filter((c) => c.status === "pending"));
      setRecovery(active);
      setRulebook(rb);
      setError(undefined);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [walletId]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 3_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <>
      {error && <p className="notice error">{error}</p>}

      {recovery && (
        <section className="notice warn" aria-live="polite">
          <p className="row-title">Your safe is being moved to a new phone</p>
          <p>
            {recovery.status === "waiting-period" && recovery.waitUntil ? (
              <>
                It happens in <Countdown until={recovery.waitUntil} />. <DemoModeNote production="48 hours" />
              </>
            ) : (
              "Someone started it and is being checked."
            )}
          </p>
          <p className="small">If this is not you, cancel it now.</p>
          <button className="button" style={{ marginTop: 12 }} onClick={() => provider.cancelRecovery(recovery.id).then(load)}>
            This is not me: cancel
          </button>
        </section>
      )}

      {pending.map((change) => (
        <section key={change.id} className="notice warn" aria-live="polite">
          <p className="row-title">{describe(change.change, rulebook)}</p>
          <p>
            Takes effect in <Countdown until={change.effectiveAt} onDone={load} />. <DemoModeNote production="24 hours" />
          </p>
          <p className="small">If you did not ask for this, cancel it now.</p>
          <button
            className="button"
            style={{ marginTop: 12 }}
            onClick={() => cosigner.cancelChange(walletId, change.id).then(load)}
          >
            Cancel this change
          </button>
        </section>
      ))}

      <ul className="rows" aria-label="Alerts">
        {alerts.length === 0 && <li className="row muted">No alerts yet.</li>}
        {alerts.map((a) => (
          <li key={a.id} className="row" style={{ alignItems: "flex-start" }}>
            <span className="row-main">
              <span>{a.message}</span>
              <br />
              <span className="small muted">{when.format(new Date(a.at))}</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
