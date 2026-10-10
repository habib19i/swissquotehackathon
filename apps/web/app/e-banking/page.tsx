"use client";

import { useState } from "react";
import { DEMO_CLIENT, type WalletRecord } from "@sqw/shared";
import { AlertsFeed } from "../../components/alerts-feed";
import { Mock } from "../../components/screen";
import { cosigner } from "../../lib/cosigner";

/**
 * MOCK: the client's OTHER device, e.g. Swissquote e-banking on a computer at home. Open it in a
 * second window during the demo: here the real client sees the alerts and cancels what they did not ask for.
 */
export default function EBankingPage() {
  const [clientNumber, setClientNumber] = useState(DEMO_CLIENT.clientNumber);
  const [record, setRecord] = useState<WalletRecord>();
  const [error, setError] = useState<string>();

  async function logIn(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    try {
      setRecord(await cosigner.walletOfClient(clientNumber.trim()));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="screen ebanking">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Swissquote e-banking
        </span>
        <span className="prototype-tag">
          <Mock>Mock: your other device</Mock>
        </span>
      </header>
      <main className="screen-body">
        {!record ? (
          <form onSubmit={logIn} style={{ display: "contents" }}>
            <h1>Log in to e-banking</h1>
            <div className="field">
              <label htmlFor="eb-client">Client number</label>
              <input id="eb-client" className="input tabular" value={clientNumber} onChange={(e) => setClientNumber(e.target.value)} />
            </div>
            {error && <p className="notice error">{error}</p>}
            <button className="button">Log in</button>
          </form>
        ) : (
          <>
            <h1>Your Swissquote Wallet</h1>
            <p className="lead">Alerts about your safe. You can cancel anything you did not ask for.</p>
            <AlertsFeed walletId={record.walletId} />
          </>
        )}
      </main>
    </div>
  );
}
