"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { explorer } from "@sqw/shared";
import { Mock, Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { formatChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";

export default function ReceivePage() {
  return <RequireWallet>{(profile) => <Receive profile={profile} />}</RequireWallet>;
}

type Target = "savings" | "pocket";
const TRANSFER_AMOUNTS_CHF = [50, 100, 200];

function Receive({ profile }: { profile: WalletProfile }) {
  const [target, setTarget] = useState<Target>("savings");
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; txid?: string }>();
  const address = target === "savings" ? profile.savingsAddress : profile.pocketAddress;
  const where = target === "savings" ? "Savings safe" : "Spending pocket";

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

  async function transfer(amountChf: number) {
    setBusy(true);
    setResult(undefined);
    try {
      const txid = await cosigner.demoTransfer(profile.walletId, amountChf, target);
      setResult({ ok: true, text: `${formatChf(amountChf)} is on its way to your ${where}. You can use it right away.`, txid });
      setChoosing(false);
    } catch (err) {
      setResult({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      back={{ href: "/" }}
      actions={
        choosing ? (
          <>
            <p className="muted">How much should Swissquote send to your {where}?</p>
            <div className="home-actions" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              {TRANSFER_AMOUNTS_CHF.map((chf) => (
                <button key={chf} className="button secondary" disabled={busy} onClick={() => transfer(chf)}>
                  {formatChf(chf)}
                </button>
              ))}
            </div>
            <button className="button quiet" disabled={busy} onClick={() => setChoosing(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="button" onClick={() => setChoosing(true)}>
              Transfer from my Swissquote account
            </button>
            <button className="button secondary" onClick={copy}>
              {copied ? "Address copied" : "Copy address"}
            </button>
            <p className="small muted">
              <Mock /> Transfers come from a demo Swissquote account holding test bitcoin.
            </p>
          </>
        )
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
      {result && (
        <p className={`notice ${result.ok ? "ok" : "error"}`} role="status">
          {result.text}
          {result.txid && (
            <>
              <br />
              <a className="small" href={explorer.btcTx(result.txid)} target="_blank" rel="noreferrer">
                View {shortId(result.txid)} on the Bitcoin network
              </a>
            </>
          )}
        </p>
      )}
      <div className="qr">{qr && <img src={qr} alt={`QR code of your ${where} address`} />}</div>
      <p className="address tabular">{address}</p>
    </Screen>
  );
}
