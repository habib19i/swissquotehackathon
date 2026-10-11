"use client";

import Link from "next/link";
import { useState } from "react";
import { maxUint256 } from "viem";
import { USDC, formatEth, formatUsdc } from "@sqw/ethereum";
import { explorer, type DefiApp, type EthSent } from "@sqw/shared";
import { shortId } from "../lib/format";
import type { WalletProfile } from "../lib/profile";
import { sendAppUse, type AppUse } from "../lib/wallet-defi";
import { OperationFailedError } from "../lib/wallet-usdc";
import { FaceIcon, ShieldIcon } from "./icons";
import { Screen } from "./screen";

/** Confirming an app operation (Explore or the assistant): what goes in, what comes back, Swissquote's check, Face ID. */
function describe(use: AppUse): { give: string; get: string } {
  const r = use.request;
  if (r.app === "uniswap") {
    const fromUsdc = r.tokenIn.toLowerCase() === USDC.address.toLowerCase();
    return { give: fromUsdc ? formatUsdc(r.amountIn) : formatEth(r.amountIn), get: `at least ${fromUsdc ? formatEth(r.minOut) : formatUsdc(r.minOut)}` };
  }
  return r.action === "supply"
    ? { give: formatEth(r.amount), get: "interest, in Aave" }
    : { give: r.amount === maxUint256 ? "all your ETH in Aave" : formatEth(r.amount), get: "back in your safe" };
}

function AppSlip({ app, use }: { app: DefiApp; use: AppUse }) {
  const { give, get } = describe(use);
  return (
    <section className="slip" aria-label="Operation details">
      <div className="slip-head">
        <span className="muted">With {app.name}</span>
        <span className="slip-amount">{give}</span>
      </div>
      <dl className="slip-details">
        <dt>You get</dt>
        <dd>{get}</dd>
        <dt>Goes to</dt>
        <dd>Your own safe</dd>
        <dt>Network fee</dt>
        <dd>Paid by Swissquote</dd>
      </dl>
    </section>
  );
}

export function AppConfirm({ profile, app, use, onCancel, onSent }: { profile: WalletProfile; app: DefiApp; use: AppUse; onCancel: () => void; onSent: (sent: EthSent) => void }) {
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<{ text: string; txHash?: string }>();
  const { review } = use;
  const blocked = review?.verdict === "BLOCKED";
  const needsConfirmation = review?.verdict === "NEEDS_CONFIRMATION";

  async function confirm() {
    setSending(true);
    setError(undefined);
    try {
      onSent(await sendAppUse(profile, use, confirmed));
    } catch (err) {
      setError({ text: (err as Error).message, txHash: err instanceof OperationFailedError ? err.sent.txHash : undefined });
      setSending(false);
    }
  }

  return (
    <Screen
      actions={
        blocked ? (
          <button className="button" onClick={onCancel}>Back</button>
        ) : (
          <>
            {needsConfirmation && !confirmed ? (
              <button className="button" onClick={() => setConfirmed(true)}>Yes, I want to do this</button>
            ) : (
              <button className="button" onClick={confirm} disabled={sending}>
                <FaceIcon /> {sending ? "Sending…" : "Confirm with Face ID"}
              </button>
            )}
            <button className="button secondary" onClick={onCancel} disabled={sending}>Cancel</button>
          </>
        )
      }
    >
      <h1>{blocked ? "Stopped" : "Check before you confirm"}</h1>
      <AppSlip app={app} use={use} />
      {use.signer === "passkey" ? (
        <p className="small muted">Only your Face ID is needed: {app.name} is one of your approved apps. Your account on Base checks it itself.</p>
      ) : null}
      {review && (
        <div className={`notice ${review.verdict === "APPROVE" ? "ok" : blocked ? "error" : "warn"}`} role="status">
          <p className="protected" style={{ color: "inherit" }}>
            <ShieldIcon size={20} /> {review.verdict === "APPROVE" ? "Checked by Swissquote" : blocked ? "Stopped by Swissquote" : "Swissquote asks you to check"}
          </p>
          {review.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error.text}
          {error.txHash && (
            <>
              <br />
              <a className="small" href={explorer.baseTx(error.txHash)} target="_blank" rel="noreferrer">View {shortId(error.txHash)} on Base</a>
            </>
          )}
        </p>
      )}
    </Screen>
  );
}

export function AppDone({ app, use, sent }: { app: DefiApp; use: AppUse; sent: EthSent }) {
  return (
    <Screen actions={<Link href="/" className="button">Back to my safe</Link>}>
      <h1>Done with {app.name}</h1>
      <AppSlip app={app} use={use} />
      <p className="notice ok">
        It is confirmed on Base, and the result is in your safe.
        <br />
        <a className="small" href={explorer.baseTx(sent.txHash)} target="_blank" rel="noreferrer">View {shortId(sent.txHash)} on Base</a>
      </p>
    </Screen>
  );
}
