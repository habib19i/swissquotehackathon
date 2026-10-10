"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { chfToSats, refillAmount } from "@sqw/bitcoin";
import { DEFAULT_POCKET_SIZE_CHF, explorer, type Alert, type WalletRecord } from "@sqw/shared";
import { CheckIcon, ReceiveIcon, SendIcon, ShieldIcon } from "../components/icons";
import { KeyHolders } from "../components/keyholders";
import { Mock, Screen } from "../components/screen";
import { RequireWallet } from "../components/wallet-context";
import { cosigner, swissquoteOnline } from "../lib/cosigner";
import { formatBtc, formatChf, formatSatsAsChf, shortId } from "../lib/format";
import { hasRecoveryKey } from "../lib/recovery-key";
import type { WalletProfile } from "../lib/profile";
import { finishSetup, swissquoteRecord } from "../lib/setup";
import { usePrice } from "../lib/use-price";
import { loadBalances, moveExcessToSavings, refillPocketNow, withShare, type Balances } from "../lib/wallet-bitcoin";

export default function HomePage() {
  return <RequireWallet>{(profile) => <Home profile={profile} />}</RequireWallet>;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Above this share of its size, the extra in the pocket is offered back to the Savings safe. */
const POCKET_EXCESS_MARGIN = 1.2;

function Home({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [balances, setBalances] = useState<Balances>();
  const [record, setRecord] = useState<WalletRecord | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ text: string; txid?: string }>();
  const [online, setOnline] = useState(true);
  const [recoveryKey, setRecoveryKey] = useState<boolean>();
  const [urgent, setUrgent] = useState<Alert>();

  const load = useCallback(() => {
    loadBalances(profile)
      .then((b) => {
        setBalances(b);
        setError(undefined);
      })
      .catch(() => setError("Balances could not be loaded from the Bitcoin network. Retrying…"));
    swissquoteRecord(profile.walletId)
      .then((r) => setRecord(r ?? null))
      .catch(() => setRecord(undefined));
    swissquoteOnline().then(setOnline);
    hasRecoveryKey(profile.walletId).then(setRecoveryKey);
    // The latest alert the client may need to act on: a change on hold, or a recovery under way.
    cosigner
      .alerts(profile.walletId)
      .then((alerts) => {
        // Alerts are newest first: a request is still open if nothing newer concerns the same change or recovery.
        const open = alerts.find(
          (a, i) =>
            (a.type === "rulebook-change-requested" || a.type === "recovery-started") &&
            !alerts.slice(0, i).some((b) => (a.changeId && b.changeId === a.changeId) || (a.recoveryId && b.recoveryId === a.recoveryId)),
        );
        setUrgent(open);
      })
      .catch(() => setUrgent(undefined));
  }, [profile]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  /** Runs one Face ID action and reports its outcome in plain language. */
  async function act(action: () => Promise<{ text: string; txid?: string } | undefined>) {
    setBusy(true);
    setDone(undefined);
    setError(undefined);
    try {
      setDone(await action());
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pocket = balances ? balances.pocket.confirmed + balances.pocket.pending : undefined;
  const savings = balances ? balances.savings.confirmed + balances.savings.pending : undefined;
  const pending = balances ? balances.pocket.pending + balances.savings.pending : 0n;
  const total = pocket !== undefined && savings !== undefined ? pocket + savings : undefined;
  const pocketSize = price ? chfToSats(DEFAULT_POCKET_SIZE_CHF, price.btcChf) : undefined;
  const excess =
    pocket !== undefined && pocketSize && pocket > (pocketSize * BigInt(POCKET_EXCESS_MARGIN * 10)) / 10n
      ? pocket - pocketSize
      : 0n;
  const refill = pocket !== undefined && pocketSize && savings ? refillAmount(pocket, pocketSize) : 0n;
  const firstName = profile.client.name.split(" ")[0];

  return (
    <Screen>
      <h1>
        {greeting()}, {firstName}
      </h1>

      <section className="safe-door" aria-label="Your safe">
        <div>
          <p className="caption">Your safe</p>
          <p className="total">{total === undefined ? "…" : formatSatsAsChf(total, price?.btcChf)}</p>
          {total !== undefined && <p className="caption tabular">{formatBtc(total)}</p>}
        </div>
        <KeyHolders ready={[true, true, true]} />
        <p className="caption" style={{ display: "flex", gap: 8, alignItems: "center", color: "#9fe0c2" }}>
          <ShieldIcon size={20} /> Protected by Swissquote
        </p>
      </section>

      {!online && (
        <p className="notice warn" role="status">
          Swissquote is offline. Your Spending pocket works as usual. Larger payments from your Savings safe use your
          recovery key and the independent safe-keeper instead.
        </p>
      )}
      {urgent && (
        <Link href="/alerts" className="notice warn" style={{ display: "block", textDecoration: "none" }}>
          <span className="row-title">Swissquote alert</span>
          <br />
          {urgent.message}
        </Link>
      )}
      {recoveryKey === false && record?.ownershipVerifiedAt && (
        <Link href="/recovery-key" className="notice warn" style={{ display: "block", textDecoration: "none" }}>
          <span className="row-title">Add your recovery key</span>
          <br />
          Without it, nobody can bring your safe back if you lose this phone.
        </Link>
      )}
      {record === null && (
        <div className="notice warn">
          <p>Swissquote has not verified this safe yet. Finish setting it up to use your Savings safe.</p>
          <button
            className="button"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() =>
              act(async () => {
                await withShare(profile, (share) => finishSetup(profile, share));
                return { text: "Swissquote has verified that this safe is yours." };
              })
            }
          >
            Finish setting up with Face ID
          </button>
        </div>
      )}
      {record?.ownershipVerifiedAt && (
        <p className="protected small">
          <CheckIcon size={20} /> Verified by Swissquote as yours
        </p>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}
      {done && (
        <p className="notice ok" role="status">
          {done.text}
          {done.txid && (
            <>
              <br />
              <a className="small" href={explorer.btcTx(done.txid)} target="_blank" rel="noreferrer">
                View {shortId(done.txid)} on the Bitcoin network
              </a>
            </>
          )}
        </p>
      )}
      {pending > 0n && (
        <p className="notice">
          {formatSatsAsChf(pending, price?.btcChf)} is on its way. Bitcoin payments usually arrive within 10 minutes.
        </p>
      )}

      <ul className="rows" aria-label="Your pockets">
        <li className="row">
          <div className="row-main">
            <p className="row-title">Spending pocket</p>
            <p className="small muted">Everyday payments with Face ID, up to {formatChf(DEFAULT_POCKET_SIZE_CHF)}</p>
          </div>
          <p className="row-amount">{pocket === undefined ? "…" : formatSatsAsChf(pocket, price?.btcChf)}</p>
        </li>
        <li className="row">
          <div className="row-main">
            <p className="row-title">Savings safe</p>
            <p className="small muted">Larger amounts, moved only with Swissquote&rsquo;s check</p>
          </div>
          <p className="row-amount">{savings === undefined ? "…" : formatSatsAsChf(savings, price?.btcChf)}</p>
        </li>
        <li className="row">
          <div className="row-main">
            <p className="row-title">Digital dollars</p>
            <p className="small muted">USDC, coming soon</p>
          </div>
        </li>
      </ul>

      {excess > 0n && price && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const txid = await moveExcessToSavings(profile, excess);
              return { text: `${formatSatsAsChf(excess, price.btcChf)} is moving to your Savings safe.`, txid };
            })
          }
        >
          Move {formatSatsAsChf(excess, price.btcChf)} to my Savings safe
        </button>
      )}
      {refill > 0n && price && record?.ownershipVerifiedAt && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const outcome = await refillPocketNow(profile, price.btcChf);
              if (outcome && "error" in outcome) throw new Error(outcome.error);
              return outcome && { text: `${formatSatsAsChf(outcome.amount, price.btcChf)} is moving to your Spending pocket.`, txid: outcome.txid };
            })
          }
        >
          Refill my Spending pocket
        </button>
      )}

      <div className="home-actions">
        <Link href="/send" className="button">
          <SendIcon /> Send
        </Link>
        <Link href="/receive" className="button secondary">
          <ReceiveIcon /> Receive
        </Link>
      </div>

      <Link href="/activity" className="button quiet">
        See all activity
      </Link>
      <Link href="/rules" className="button quiet">
        Contacts and rules
      </Link>
      <Link href="/alerts" className="button quiet">
        Alerts
      </Link>
      <Link href="/settings" className="button quiet">
        Plan and settings
      </Link>
      <Link href="/demo" className="button quiet">
        Demo panel
      </Link>

      <p className="small muted">
        Test bitcoin on the Bitcoin test network, shown at the {price?.mock ? "fixed demo" : "live"} price for
        illustration{price?.mock && <> <Mock /></>}.
      </p>
    </Screen>
  );
}
