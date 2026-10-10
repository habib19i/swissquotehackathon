"use client";

import { useEffect, useState } from "react";
import { explorer } from "@sqw/shared";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { formatSatsAsChf } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usePrice } from "../../lib/use-price";
import { loadActivity, type ActivityItem } from "../../lib/wallet-bitcoin";

export default function ActivityPage() {
  return <RequireWallet>{(profile) => <Activity profile={profile} />}</RequireWallet>;
}

const when = new Intl.DateTimeFormat("en-CH", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function Activity({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [items, setItems] = useState<ActivityItem[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadActivity(profile)
      .then(setItems)
      .catch(() => setError("Your activity could not be loaded from the Bitcoin network. Try again in a moment."));
  }, [profile]);

  return (
    <Screen back={{ href: "/" }}>
      <h1>Activity</h1>
      {error && <p className="notice error">{error}</p>}
      {items?.length === 0 && <p className="muted">Nothing yet. Payments in and out of your safe will appear here.</p>}
      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((item) => (
            <li key={item.txid}>
              <a className="row" href={explorer.btcTx(item.txid)} target="_blank" rel="noreferrer">
                <span className="row-main">
                  <span className="row-title">{item.label}</span>
                  <br />
                  <span className="small muted">
                    {item.confirmed ? (item.time ? when.format(item.time) : "Confirmed") : "On its way"}
                    {item.fee > 0n && `, network fee ${formatSatsAsChf(item.fee, price?.btcChf)}`}
                  </span>
                </span>
                <span className="row-amount">
                  {item.amount > 0n ? "+" : ""}
                  {formatSatsAsChf(item.amount, price?.btcChf)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Tap a payment to see it on the Bitcoin network.</p>
    </Screen>
  );
}
