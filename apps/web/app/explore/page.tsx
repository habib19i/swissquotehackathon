"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { searchApps, type Rulebook } from "@sqw/shared";
import { ChevronIcon, QrIcon, SearchIcon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { AppMark } from "../../components/tokens";
import { RequireWallet } from "../../components/wallet-context";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook } from "../../lib/rules";

export default function ExplorePage() {
  return <RequireWallet>{(profile) => <Explore profile={profile} />}</RequireWallet>;
}

/** Explore: DeFi apps Swissquote has looked at. A curated list, not the open web. */
function Explore({ profile }: { profile: WalletProfile }) {
  const [query, setQuery] = useState("");
  const [rulebook, setRulebook] = useState<Rulebook>();

  useEffect(() => {
    loadRulebook(profile.walletId).then(setRulebook);
  }, [profile]);

  const apps = searchApps(query);
  const approved = new Set(rulebook?.apps ?? []);

  return (
    <Screen tabs>
      <h1>Explore</h1>
      <p className="lead">Apps Swissquote has checked for you. Whatever you get back always lands in your own safe.</p>
      <label className="search-box">
        <SearchIcon size={22} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: exchange, earn, Aave…" aria-label="Search apps" />
      </label>
      <Link href="/explore/scan" className="button secondary">
        <QrIcon /> Scan an app&rsquo;s QR code
      </Link>

      {apps.length === 0 && <p className="muted">No app matches &ldquo;{query}&rdquo;.</p>}
      <ul className="assets" aria-label="Apps">
        {apps.map((app, i) => (
          <li key={app.id} className="rise" style={{ "--i": i } as React.CSSProperties}>
            <Link href={`/explore/${app.id}`} className="asset">
              <AppMark id={app.id} />
              <span className="row-main">
                <span className="row-title">{app.name}</span>
                <br />
                <span className="small muted">{app.tagline}</span>
              </span>
              <span className={`status-chip ${approved.has(app.id) ? "approved" : "live"}`}>{approved.has(app.id) ? "Face ID" : app.category}</span>
              <ChevronIcon size={18} />
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
