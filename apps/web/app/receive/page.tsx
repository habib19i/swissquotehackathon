"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Mock, Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import type { WalletProfile } from "../../lib/profile";

export default function ReceivePage() {
  return <RequireWallet>{(profile) => <Receive profile={profile} />}</RequireWallet>;
}

type Target = "savings" | "pocket";

function Receive({ profile }: { profile: WalletProfile }) {
  const [target, setTarget] = useState<Target>("savings");
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const address = target === "savings" ? profile.savingsAddress : profile.pocketAddress;

  useEffect(() => {
    setCopied(false);
    QRCode.toDataURL(`bitcoin:${address}`, { margin: 0, width: 480, color: { dark: "#13212b", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(undefined));
  }, [address]);

  async function copy() {
    await navigator.clipboard.writeText(address);
    setCopied(true);
  }

  return (
    <Screen
      back={{ href: "/" }}
      actions={
        <>
          <button className="button" onClick={copy}>
            {copied ? "Address copied" : "Copy address"}
          </button>
          <button className="button secondary" disabled aria-describedby="transfer-note">
            Transfer from my Swissquote account
          </button>
          <p id="transfer-note" className="small muted">
            <Mock /> Transfers from your Swissquote account are simulated and not available yet.
          </p>
        </>
      }
    >
      <h1>Receive bitcoin</h1>
      <div className="segmented" role="group" aria-label="Where should the bitcoin go?">
        <button aria-pressed={target === "savings"} onClick={() => setTarget("savings")}>
          Savings safe
        </button>
        <button aria-pressed={target === "pocket"} onClick={() => setTarget("pocket")}>
          Spending pocket
        </button>
      </div>
      <p className="muted">
        {target === "savings"
          ? "For larger amounts. Moving them out needs your Face ID and Swissquote's check."
          : "For everyday payments with Face ID only. Keep about CHF 100 here."}
      </p>
      <div className="qr">{qr && <img src={qr} alt={`QR code of your ${target === "savings" ? "Savings safe" : "Spending pocket"} address`} />}</div>
      <p className="address tabular">{address}</p>
      <p className="small muted">
        This is the Bitcoin test network. Get free test bitcoin from a{" "}
        <a href="https://signetfaucet.com" target="_blank" rel="noreferrer">
          test faucet
        </a>
        .
      </p>
    </Screen>
  );
}
