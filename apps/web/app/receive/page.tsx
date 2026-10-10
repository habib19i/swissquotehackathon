"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { explorer } from "@sqw/shared";
import { Mock, Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { formatChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usdcAccount } from "../../lib/wallet-usdc";

export default function ReceivePage() {
  return <RequireWallet>{(profile) => <Receive profile={profile} />}</RequireWallet>;
}

type Target = "savings" | "pocket" | "usdc";

const PLACES: Record<Target, string> = { savings: "Savings safe", pocket: "Spending pocket", usdc: "digital dollars" };
const EXPLAINED: Record<Target, string> = {
  savings: "For larger amounts. Moving them out needs your Face ID and Swissquote's check.",
  pocket: "For everyday payments with Face ID only. Keep about CHF 100 here.",
  usdc: "Digital dollars (USDC) on the Base network. Face ID pays your contacts within your daily limit.",
};
/** The faucet gives the demo account small amounts of test USDC, so digital dollar transfers are smaller. */
const TRANSFER_AMOUNTS_CHF: Record<Target, number[]> = { savings: [50, 100, 200], pocket: [50, 100, 200], usdc: [5, 10, 15] };

function Receive({ profile }: { profile: WalletProfile }) {
  const [target, setTarget] = useState<Target>("savings");
  const [qr, setQr] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: { href: string; label: string } }>();
  const [usdcAddress, setUsdcAddress] = useState<string>();
  const [usdcError, setUsdcError] = useState<string>();
  const address = target === "savings" ? profile.savingsAddress : target === "pocket" ? profile.pocketAddress : usdcAddress;
  const where = PLACES[target];

  useEffect(() => {
    usdcAccount(profile)
      .then((r) => setUsdcAddress(r.address))
      .catch((err) => setUsdcError((err as Error).message));
  }, [profile]);

  useEffect(() => {
    setCopied(false);
    setQr(undefined);
    if (!address) return;
    // BIP-21 for bitcoin, EIP-681 (address on chain 84532) for digital dollars.
    const uri = target === "usdc" ? `ethereum:${address}@84532` : `bitcoin:${address}`;
    QRCode.toDataURL(uri, { margin: 0, width: 480, color: { dark: "#13212b", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(undefined));
  }, [address, target]);

  async function copy() {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
  }

  async function transfer(amountChf: number) {
    setBusy(true);
    setResult(undefined);
    try {
      if (target === "usdc") {
        const txHash = await cosigner.demoTransferUsdc(profile.walletId, amountChf);
        const link = { href: explorer.baseTx(txHash), label: `View ${shortId(txHash)} on Base` };
        setResult({ ok: true, text: `${formatChf(amountChf)} in digital dollars has arrived.`, link });
      } else {
        const txid = await cosigner.demoTransfer(profile.walletId, amountChf, target);
        const link = { href: explorer.btcTx(txid), label: `View ${shortId(txid)} on the Bitcoin network` };
        setResult({ ok: true, text: `${formatChf(amountChf)} is on its way to your ${where}. You can use it right away.`, link });
      }
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
              {TRANSFER_AMOUNTS_CHF[target].map((chf) => (
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
            <button className="button" onClick={() => setChoosing(true)} disabled={!address}>
              Transfer from my Swissquote account
            </button>
            <button className="button secondary" onClick={copy} disabled={!address}>
              {copied ? "Address copied" : "Copy address"}
            </button>
            <p className="small muted">
              <Mock /> Transfers come from a demo Swissquote account holding test bitcoin and test USDC.
            </p>
          </>
        )
      }
    >
      <h1>Receive</h1>
      <div className="segmented" role="group" aria-label="Where should the money go?">
        <button aria-pressed={target === "savings"} onClick={() => setTarget("savings")}>
          Savings safe
        </button>
        <button aria-pressed={target === "pocket"} onClick={() => setTarget("pocket")}>
          Spending pocket
        </button>
        <button aria-pressed={target === "usdc"} onClick={() => setTarget("usdc")}>
          Digital dollars
        </button>
      </div>
      <p className="muted">{EXPLAINED[target]}</p>
      {target === "usdc" && usdcError && <p className="notice error">{usdcError}</p>}
      {result && (
        <p className={`notice ${result.ok ? "ok" : "error"}`} role="status">
          {result.text}
          {result.link && (
            <>
              <br />
              <a className="small" href={result.link.href} target="_blank" rel="noreferrer">
                {result.link.label}
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
