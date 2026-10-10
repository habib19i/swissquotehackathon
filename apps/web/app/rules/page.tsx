"use client";

import { useCallback, useEffect, useState } from "react";
import type { PendingChange, Rulebook, RulebookChange } from "@sqw/shared";
import { Countdown, DemoModeNote } from "../../components/countdown";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { formatChf } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook, requestChange } from "../../lib/rules";

export default function RulesPage() {
  return <RequireWallet>{(profile) => <Rules profile={profile} />}</RequireWallet>;
}

/**
 * The rulebook (screen 6). Loosening changes (a new contact, a higher limit) wait 24 hours (demo: 30 s)
 * and can be cancelled; tightening changes are instant. Swissquote enforces this, not the app.
 */
function Rules({ profile }: { profile: WalletProfile }) {
  const [rulebook, setRulebook] = useState<Rulebook>();
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState<"daily" | "pocket">();
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    setRulebook(await loadRulebook(profile.walletId));
    setPending((await cosigner.changes(profile.walletId).catch(() => [])).filter((c) => c.status === "pending"));
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function change(c: RulebookChange, done: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await requestChange(profile, c);
      setMessage({ ok: true, text: done });
      setAdding(false);
      await load();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function saveLimit(event: React.FormEvent) {
    event.preventDefault();
    const chf = Number(amount.replace(",", "."));
    if (!rulebook || !editing || !(chf > 0)) return;
    const daily = editing === "daily";
    const current = daily ? rulebook.dailyLimitChf : rulebook.pocketSizeChf;
    const label = daily ? "Your daily limit" : "Your Spending pocket size";
    change(
      daily ? { kind: "setDailyLimit", dailyLimitChf: chf } : { kind: "setPocketSize", pocketSizeChf: chf },
      chf > current ? `Requested: ${label.toLowerCase()} becomes ${formatChf(chf)} after the waiting period.` : `Done: ${label.toLowerCase()} is now ${formatChf(chf)}.`,
    ).then(() => setEditing(undefined));
  }

  function startEditing(which: "daily" | "pocket") {
    setEditing(which);
    setAmount(String(which === "daily" ? rulebook!.dailyLimitChf : rulebook!.pocketSizeChf));
  }

  if (!rulebook) return null;

  return (
    <Screen back={{ href: "/" }}>
      <h1>Contacts and rules</h1>
      <p className="lead">
        Making your rules stricter is instant. Loosening them takes 24 hours, so you can stop anything you did not ask
        for. <DemoModeNote production="24 hours, not 30 seconds," />
      </p>
      {message && <p className={`notice ${message.ok ? "ok" : "error"}`} role="status">{message.text}</p>}

      {pending.map((p) => (
        <section key={p.id} className="notice warn">
          <p className="row-title">
            {p.change.kind === "addContact"
              ? `Adding ${p.change.contact.name}`
              : p.change.kind === "setDailyLimit"
                ? `Daily limit to ${formatChf(p.change.dailyLimitChf)}`
                : p.change.kind === "setPocketSize"
                  ? `Pocket size to ${formatChf(p.change.pocketSizeChf)}`
                  : "Unfreezing your safe"}
          </p>
          <p>
            Takes effect in <Countdown until={p.effectiveAt} onDone={load} />
          </p>
          <button className="button secondary" style={{ marginTop: 12 }} onClick={() => cosigner.cancelChange(profile.walletId, p.id).then(load)}>
            Cancel
          </button>
        </section>
      ))}

      <h2>Your contacts</h2>
      <ul className="rows">
        {rulebook.contacts.map((c) => (
          <li key={c.id} className="row">
            <span className="avatar" aria-hidden="true">
              {c.name[0]}
            </span>
            <span className="row-main">
              <span className="row-title">{c.name}</span>
              <br />
              <span className="small muted">{c.relation ?? "Contact"}</span>
            </span>
            <button
              className="button quiet"
              style={{ width: "auto" }}
              disabled={busy}
              onClick={() => change({ kind: "removeContact", contactId: c.id }, `Done: ${c.name} is no longer a contact.`)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>

      {adding ? (
        <form
          className="notice"
          onSubmit={(e) => {
            e.preventDefault();
            const id = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
            change(
              { kind: "addContact", contact: { id, name: name.trim(), btcAddress: address.trim() } },
              `Requested: ${name.trim()} becomes a contact after the waiting period, once Swissquote has checked the address.`,
            );
          }}
        >
          <div className="field">
            <label htmlFor="contact-name">Name</label>
            <input id="contact-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="contact-address">Their Bitcoin address</label>
            <input id="contact-address" className="input" value={address} onChange={(e) => setAddress(e.target.value)} required />
          </div>
          <button className="button" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? "Waiting for Face ID…" : "Add with Face ID"}
          </button>
        </form>
      ) : (
        <button className="button secondary" onClick={() => setAdding(true)}>
          Add a contact
        </button>
      )}

      <h2>Your limits</h2>
      <ul className="rows">
        <li className="row">
          <span className="row-main">
            <span className="row-title">Daily limit</span>
            <br />
            <span className="small muted">Payments above it need your extra confirmation</span>
          </span>
          <button className="button quiet" style={{ width: "auto" }} disabled={busy} onClick={() => startEditing("daily")}>
            {formatChf(rulebook.dailyLimitChf)}
          </button>
        </li>
        <li className="row">
          <span className="row-main">
            <span className="row-title">Spending pocket size</span>
            <br />
            <span className="small muted">What your phone can spend on its own</span>
          </span>
          <button className="button quiet" style={{ width: "auto" }} disabled={busy} onClick={() => startEditing("pocket")}>
            {formatChf(rulebook.pocketSizeChf)}
          </button>
        </li>
      </ul>

      {editing && (
        <form className="notice" onSubmit={saveLimit}>
          <label className="amount-entry">
            <span>CHF</span>
            <input
              inputMode="decimal"
              autoFocus
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label={editing === "daily" ? "New daily limit in Swiss francs" : "New Spending pocket size in Swiss francs"}
            />
          </label>
          <button className="button" style={{ marginTop: 16 }} disabled={busy}>
            {busy ? "Waiting for Face ID…" : "Save with Face ID"}
          </button>
          <button type="button" className="button quiet" onClick={() => setEditing(undefined)}>
            Cancel
          </button>
        </form>
      )}

      {rulebook.frozen ? (
        <button className="button secondary" disabled={busy} onClick={() => change({ kind: "unfreeze" }, "Requested: your safe unfreezes after the waiting period.")}>
          Unfreeze my safe
        </button>
      ) : (
        <button className="button secondary" disabled={busy} onClick={() => change({ kind: "freeze" }, "Done: your safe is frozen. No payment can leave the Savings safe.")}>
          Freeze my safe
        </button>
      )}
    </Screen>
  );
}
