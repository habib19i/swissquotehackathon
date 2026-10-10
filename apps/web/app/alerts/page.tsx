"use client";

import { AlertsFeed } from "../../components/alerts-feed";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";

/** Alerts from Swissquote's Watcher (screen 7), with the changes and recoveries the client can cancel. */
export default function AlertsPage() {
  return (
    <RequireWallet>
      {(profile) => (
        <Screen back={{ href: "/" }}>
          <h1>Alerts</h1>
          <p className="lead">Swissquote tells you about every important change to your safe, on every channel.</p>
          <AlertsFeed walletId={profile.walletId} />
        </Screen>
      )}
    </RequireWallet>
  );
}
