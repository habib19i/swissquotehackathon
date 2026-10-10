"use client";

import Link from "next/link";
import { explorer } from "@sqw/shared";
import { useState } from "react";
import { FaceIcon, ShieldIcon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { formatBtc, formatSatsAsChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usePrice } from "../../lib/use-price";
import { sendPayment, type PaymentResult, type PreparedPayment } from "../../lib/wallet-bitcoin";

/** Bitcoin payments: the confirmation card (Face ID) and the result. Shared by Send and the assistant. */
export function BitcoinConfirm({
  profile,
  payment,
  onCancel,
  onSent,
}: {
  profile: WalletProfile;
  payment: PreparedPayment;
  onCancel: () => void;
  onSent: (result: PaymentResult) => void;
}) {
  const price = usePrice();
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string>();
  const review = payment.from === "savings" ? payment.review : undefined;
  const blocked = review?.verdict === "BLOCKED";
  const needsConfirmation = review?.verdict === "NEEDS_CONFIRMATION";

  async function confirm() {
    if (!price) return;
    setError(undefined);
    setSending(true);
    try {
      onSent(await sendPayment(profile, payment, price.btcChf, confirmed));
    } catch (err) {
      setError((err as Error).message);
      setSending(false);
    }
  }

  return (
    <Screen
      actions={
        blocked ? (
          <Link href="/" className="button">
            Back to my safe
          </Link>
        ) : (
          <>
            {needsConfirmation && !confirmed ? (
              <button className="button" onClick={() => setConfirmed(true)}>
                Yes, I want to make this payment
              </button>
            ) : (
              <button className="button" onClick={confirm} disabled={sending || !price}>
                <FaceIcon /> {sending ? "Sending…" : "Confirm with Face ID"}
              </button>
            )}
            <button className="button secondary" onClick={onCancel} disabled={sending}>
              Cancel
            </button>
          </>
        )
      }
    >
      <h1>{blocked ? "Payment stopped" : "Check your payment"}</h1>
      <PaymentSlip payment={payment} />
      {payment.from === "pocket" && (
        <p className="small muted">Payments from your Spending pocket only need your Face ID. Swissquote does not sign them.</p>
      )}
      {payment.from === "savings" && payment.via === "recovery-provider" && (
        <p className="notice warn">
          Swissquote is offline, so your recovery key and the independent safe-keeper approve this payment instead.
          You will be asked for your Face ID, then for your recovery key.
        </p>
      )}
      {review && (
        <div className={`notice ${review.verdict === "APPROVE" ? "ok" : review.verdict === "BLOCKED" ? "error" : "warn"}`} role="status">
          <p className="protected" style={{ color: "inherit" }}>
            <ShieldIcon size={20} />
            {review.verdict === "APPROVE" ? "Checked by Swissquote" : review.verdict === "BLOCKED" ? "Stopped by Swissquote" : "Swissquote asks you to check"}
          </p>
          {review.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
    </Screen>
  );
}

function PaymentSlip({ payment }: { payment: PreparedPayment }) {
  const price = usePrice();
  const { contact } = payment;
  const { spend, feeNote } = payment.draft;
  const swissquotePays = spend.paidBy === "swissquote";
  return (
    <section className="slip" aria-label="Payment details">
      <div className="slip-head">
        <span className="muted">You send to {contact.name}</span>
        <span className="slip-amount">{formatSatsAsChf(spend.amount, price?.btcChf)}</span>
        <span className="small muted tabular">{formatBtc(spend.amount)}</span>
      </div>
      <dl className="slip-details">
        <dt>To</dt>
        <dd>
          {contact.name} ({contact.relation})
        </dd>
        <dt>From</dt>
        <dd>{payment.from === "pocket" ? "Spending pocket" : "Savings safe"}</dd>
        <dt>Network fee</dt>
        <dd>
          {formatSatsAsChf(spend.fee, price?.btcChf)}, paid by {swissquotePays ? "Swissquote" : "you"}
        </dd>
        <dt>You pay in total</dt>
        <dd>{formatSatsAsChf(spend.amount + (swissquotePays ? 0n : spend.fee), price?.btcChf)}</dd>
      </dl>
      {feeNote && <p className="small muted slip-note">{feeNote}</p>}
    </section>
  );
}

export function BitcoinSent({ payment, result }: { payment: PreparedPayment; result: PaymentResult }) {
  const price = usePrice();
  const { refill } = result;
  return (
    <Screen
      actions={
        <Link href="/" className="button">
          Back to my safe
        </Link>
      }
    >
      <h1>Sent to {payment.contact.name}</h1>
      <PaymentSlip payment={payment} />
      <p className="notice ok">
        Your payment is on the Bitcoin network. It usually arrives within 10 minutes.
        <br />
        <a className="small" href={explorer.btcTx(result.txid)} target="_blank" rel="noreferrer">
          View payment {shortId(result.txid)} on the Bitcoin network
        </a>
      </p>
      {refill && "txid" in refill && (
        <p className="notice">
          Your Spending pocket was running low, so {formatSatsAsChf(refill.amount, price?.btcChf)} moved to it from your
          Savings safe, checked by Swissquote.
          <br />
          <a className="small" href={explorer.btcTx(refill.txid)} target="_blank" rel="noreferrer">
            View refill {shortId(refill.txid)}
          </a>
        </p>
      )}
      {refill && "error" in refill && <p className="notice">{refill.error}</p>}
    </Screen>
  );
}
