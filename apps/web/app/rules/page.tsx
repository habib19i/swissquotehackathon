"use client";

import { useCallback, useEffect, useState } from "react";
import { appById, explorer, type ContactScreening, type EthStatus, type PendingChange, type Rulebook, type RulebookChange } from "@sqw/shared";
import { Countdown, DemoModeNote } from "../../components/countdown";
import { CheckIcon, ShieldIcon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { formatChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook, requestChange, type ChangeResult } from "../../lib/rules";
import { updateRulesOnBase, usdcAccount } from "../../lib/wallet-usdc";
import { AppMark } from "../../components/tokens";
import Link from "next/link";

export default function RulesPage() {
  return <RequireWallet>{(profile) => <Rules profile={profile} />}</RequireWallet>;
}

/**
 * The rulebook (screen 6). Loosening changes (a new contact, a higher limit) wait 24 hours (demo: 30 s)
 * and can be cancelled; tightening changes are instant. Swissquote enforces this, not the app. Rules in
 * force are then written to the client's account on Base, which enforces them for Face ID payments.
 */
function Rules({ profile }: { profile: WalletProfile }) {
  const [rulebook, setRulebook] = useState<Rulebook>();
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; base?: ChangeResult["base"] }>();
  const [onBase, setOnBase] = useState<EthStatus>();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [usdcAddress, setUsdcAddress] = useState("");
  /** Swissquote's checks of the contact being added, shown before Face ID. */
  const [screening, setScreening] = useState<ContactScreening>();
  /** Editing the contact means Swissquote has to check it again. */
  const edited = (set: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setScreening(undefined);
  };
  const [editing, setEditing] = useState<"daily" | "pocket">();
  const [amount, setAmount] = useState("");

  const load = useCallback(async () => {
    setRulebook(await loadRulebook(profile.walletId));
    setPending((await cosigner.changes(profile.walletId).catch(() => [])).filter((c) => c.status === "pending"));
    const hasUsdc = await usdcAccount(profile).then(() => true, () => false);
    setOnBase(hasUsdc ? await cosigner.ethStatus(profile.walletId).catch(() => undefined) : undefined);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  // "Add Marc as a contact" in the assistant opens the form here, with the name filled in.
  useEffect(() => {
    const name = new URLSearchParams(window.location.search).get("add");
    if (!name) return;
    window.history.replaceState(null, "", "/rules");
    setName(name.slice(0, 40));
    setAdding(true);
    setTimeout(() => document.getElementById("contact-address")?.focus(), 0);
  }, []);

  async function change(c: RulebookChange, done: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      const { base } = await requestChange(profile, c);
      setMessage({ ok: true, text: done, base });
      setAdding(false);
      setScreening(undefined);
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

  async function writeOnBase() {
    setBusy(true);
    setMessage(undefined);
    try {
      const base = await updateRulesOnBase(profile);
      setMessage({ ok: true, text: "Your rules are now written on Base.", base });
      await load();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!rulebook) return null;

  return (
    <Screen tabs>
      <h1>Contacts and rules</h1>
      <p className="lead">
        Making your rules stricter is instant. Loosening them takes 24 hours, so you can stop anything you did not ask
        for. <DemoModeNote production="24 hours, not 30 seconds," />
      </p>
      {message && (
        <p className={`notice ${message.ok ? "ok" : "error"}`} role="status">
          {message.text}
          <BaseUpdate base={message.base} />
        </p>
      )}
      {onBase && !onBase.rulesUpToDate && pending.length === 0 && (
        <section className="notice warn">
          <p className="row-title">New rules to write on Base</p>
          <p>Your USDC account still follows your previous rules. Confirm with Face ID to bring it up to date.</p>
          <button className="button" style={{ marginTop: 12 }} disabled={busy} onClick={writeOnBase}>
            {busy ? "Waiting for Face ID…" : "Update with Face ID"}
          </button>
        </section>
      )}

      {pending.map((p) => (
        <section key={p.id} className="notice warn">
          <p className="row-title">
            {p.change.kind === "addContact"
              ? `Adding ${p.change.contact.name}`
              : p.change.kind === "setDailyLimit"
                ? `Daily limit to ${formatChf(p.change.dailyLimitChf)}`
                : p.change.kind === "setPocketSize"
                  ? `Pocket size to ${formatChf(p.change.pocketSizeChf)}`
                  : p.change.kind === "addApp"
                    ? `${appById(p.change.appId)?.name ?? "An app"} with Face ID alone`
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
            const contact = {
              id,
              name: name.trim(),
              ...(address.trim() && { btcAddress: address.trim() }),
              ...(usdcAddress.trim() && { ethAddress: usdcAddress.trim() as `0x${string}` }),
            };
            if (!screening) {
              cosigner
                .shieldContact(profile.walletId, contact)
                .then(setScreening)
                .catch((err) => setMessage({ ok: false, text: (err as Error).message }));
              return;
            }
            change(
              { kind: "addContact", contact },
              `Requested: ${name.trim()} becomes a contact after the waiting period, once Swissquote has checked the address.`,
            );
          }}
        >
          <div className="field">
            <label htmlFor="contact-name">Name</label>
            <input id="contact-name" className="input" value={name} onChange={edited(setName)} required />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="contact-address">Their Bitcoin address</label>
            <input id="contact-address" className="input" value={address} onChange={edited(setAddress)} />
          </div>
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="contact-usdc">Their USDC address</label>
            <input
              id="contact-usdc"
              className="input"
              value={usdcAddress}
              onChange={edited(setUsdcAddress)}
              placeholder="0x…"
            />
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>
            Give at least one.
          </p>
          {screening && <ScreeningCard screening={screening} />}
          <button className="button" style={{ marginTop: 16 }} disabled={busy || screening?.verdict === "BLOCKED"}>
            {busy ? "Waiting for Face ID…" : !screening ? "Check with Swissquote" : screening.verdict === "BLOCKED" ? "Swissquote cannot add this contact" : "Add with Face ID"}
          </button>
        </form>
      ) : (
        <button className="button secondary" onClick={() => setAdding(true)}>
          Add a contact
        </button>
      )}

      <h2>Approved apps</h2>
      <ul className="rows">
        {(rulebook.apps ?? []).length === 0 && (
          <li className="row">
            <span className="row-main small muted">
              None yet. In <Link href="/explore">Explore</Link>, approve an app to use it with Face ID alone, within a daily limit.
            </span>
          </li>
        )}
        {(rulebook.apps ?? []).map((id) => {
          const app = appById(id);
          return (
            <li key={id} className="row">
              {app && <AppMark id={app.id} size={40} />}
              <span className="row-main">
                <span className="row-title">{app?.name ?? id}</span>
                <br />
                <span className="small muted">Face ID alone, within a daily limit</span>
              </span>
              <button
                className="button quiet"
                style={{ width: "auto" }}
                disabled={busy}
                onClick={() => change({ kind: "removeApp", appId: id }, `Done: ${app?.name ?? "the app"} now needs Swissquote's check again.`)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>

      <h2>Your limits</h2>
      <ul className="rows">
        <li className="row">
          <span className="row-main">
            <span className="row-title">Daily limit</span>
            <br />
            <span className="small muted">Face ID alone pays your contacts up to this each day; above it, Swissquote asks you to confirm</span>
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

/** The outcome of writing the rules on Base, under a change's message. */
function BaseUpdate({ base }: { base?: ChangeResult["base"] }) {
  if (!base) return null;
  if ("error" in base) return <><br /><span className="small">Your rules on Base could not be updated yet: {base.error}</span></>;
  return (
    <>
      <br />
      <a className="small" href={explorer.baseTx(base.txHash)} target="_blank" rel="noreferrer">
        Also written on Base: {shortId(base.txHash)}
      </a>
    </>
  );
}

/** The scam shield's checks of a new contact, in plain language (CLAUDE.md section 9). */
function ScreeningCard({ screening }: { screening: ContactScreening }) {
  const blocked = screening.verdict === "BLOCKED";
  return (
    <div className={`notice ${blocked ? "error" : "warn"}`} style={{ marginTop: 16 }} role="status">
      <p className="protected" style={{ color: "inherit" }}>
        <ShieldIcon size={20} /> {blocked ? "Stopped by Swissquote" : "Checked by Swissquote"}
      </p>
      <ul className="checks">
        {screening.checks.map((check) => (
          <li key={check.label} className={check.result}>
            <span aria-hidden="true">{check.result === "pass" ? <CheckIcon size={18} /> : check.result === "fail" ? "✕" : "!"}</span>
            <span>
              <strong>{check.label}.</strong> {check.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
