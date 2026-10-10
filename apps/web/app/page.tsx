"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEFAULT_POCKET_SIZE_CHF } from "@sqw/shared";
import { ReceiveIcon, SendIcon, ShieldIcon } from "../components/icons";
import { KeyHolders } from "../components/keyholders";
import { Mock, Screen } from "../components/screen";
import { RequireWallet } from "../components/wallet-context";
import { formatBtc, formatChf, formatSatsAsChf } from "../lib/format";
import type { WalletProfile } from "../lib/profile";
import { usePrice } from "../lib/use-price";
import { loadBalances, type Balances } from "../lib/wallet-bitcoin";

export default function HomePage() {
  return <RequireWallet>{(profile) => <Home profile={profile} />}</RequireWallet>;
}

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

function Home({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [balances, setBalances] = useState<Balances>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const load = () =>
      loadBalances(profile)
        .then((b) => {
          setBalances(b);
          setError(undefined);
        })
        .catch(() => setError("Balances could not be loaded from the Bitcoin network. Retrying…"));
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [profile]);

  const pocket = balances ? balances.pocket.confirmed + balances.pocket.pending : undefined;
  const savings = balances ? balances.savings.confirmed + balances.savings.pending : undefined;
  const pending = balances ? balances.pocket.pending + balances.savings.pending : 0n;
  const total = pocket !== undefined && savings !== undefined ? pocket + savings : undefined;
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

      {error && <p className="notice error">{error}</p>}
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

      <p className="small muted">
        Test bitcoin on the Bitcoin test network, shown at the {price?.mock ? "fixed demo" : "live"} price for
        illustration{price?.mock && <> <Mock /></>}.
      </p>
    </Screen>
  );
}
