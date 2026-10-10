"use client";

import { useEffect, useState } from "react";
import { satsToChf } from "@sqw/bitcoin";
import { chfForUsdc } from "@sqw/ethereum";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { formatChf } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usePrice } from "../../lib/use-price";
import { loadActivity, type ActivityItem } from "../../lib/activity";

export default function ActivityPage() {
  return <RequireWallet>{(profile) => <Activity profile={profile} />}</RequireWallet>;
}

const when = new Intl.DateTimeFormat("en-CH", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function Activity({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [items, setItems] = useState<ActivityItem[]>();
  const [unavailable, setUnavailable] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    loadActivity(profile)
      .then((activity) => {
        setItems(activity.items);
        setUnavailable(activity.unavailable);
      })
      .catch(() => setError("Your activity could not be loaded. Try again in a moment."));
  }, [profile]);

  const chf = (item: ActivityItem, amount: bigint) => {
    if (!price) return "…";
    return formatChf(item.asset === "BTC" ? satsToChf(amount, price.btcChf) : chfForUsdc(amount, price.usdcChf));
  };

  return (
    <Screen back={{ href: "/" }}>
      <h1>Activity</h1>
      {error && <p className="notice error">{error}</p>}
      {unavailable.length > 0 && (
        <p className="notice warn">Your {unavailable.join(" and ")} activity could not be loaded right now. Try again in a moment.</p>
      )}
      {items?.length === 0 && <p className="muted">Nothing yet. Payments in and out of your safe will appear here.</p>}
      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((item) => (
            <li key={item.id}>
              <a className="row" href={item.link} target="_blank" rel="noreferrer">
                <span className="row-main">
                  <span className="row-title">{item.label}</span>
                  <br />
                  <span className="small muted">
                    {item.asset === "USDC" ? "Digital dollars · " : "Bitcoin · "}
                    {item.confirmed ? (item.time ? when.format(item.time) : "Confirmed") : "On its way"}
                    {item.fee > 0n && `, network fee ${chf(item, item.fee)}`}
                  </span>
                </span>
                <span className="row-amount">
                  {item.amount > 0n ? "+" : ""}
                  {chf(item, item.amount)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="small muted">Tap a payment to see it on its network.</p>
    </Screen>
  );
}
