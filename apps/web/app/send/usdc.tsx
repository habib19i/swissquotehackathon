"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { chfForUsdc, formatUsdc, usdcForChf } from "@sqw/ethereum";
import { explorer, type Contact, type EthSent } from "@sqw/shared";
import { FaceIcon, ShieldIcon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { cosigner } from "../../lib/cosigner";
import { formatChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usePrice } from "../../lib/use-price";
import { OperationFailedError, loadUsdcBalance, prepareUsdcPayment, sendUsdcPayment, type UsdcPayment } from "../../lib/wallet-usdc";

/** USDC payments (USDC on Base): amount, confirmation card, and the result. */
export function UsdcSend({ profile, contact, onBack }: { profile: WalletProfile; contact: Contact; onBack: () => void }) {
  const [payment, setPayment] = useState<UsdcPayment>();
  const [sent, setSent] = useState<EthSent>();

  if (sent && payment) return <UsdcSent payment={payment} sent={sent} />;
  if (payment) return <UsdcConfirm profile={profile} payment={payment} onCancel={onBack} onSent={setSent} />;
  return <UsdcAmount profile={profile} contact={contact} onBack={onBack} onReady={setPayment} />;
}

function parseChf(input: string): number {
  const value = Number(input.replace(",", ".").replace(/['’\s]/g, ""));
  return Number.isFinite(value) ? value : NaN;
}

function UsdcAmount({
  profile,
  contact,
  onBack,
  onReady,
}: {
  profile: WalletProfile;
  contact: Contact;
  onBack: () => void;
  onReady: (payment: UsdcPayment) => void;
}) {
  const price = usePrice();
  const [input, setInput] = useState("");
  const [balance, setBalance] = useState<bigint>();
  const [today, setToday] = useState<bigint>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadUsdcBalance(profile)
      .then(setBalance)
      .catch((err) => setError((err as Error).message));
    cosigner
      .ethStatus(profile.walletId)
      .then((s) => setToday(BigInt(s.onChain.remainingToday)))
      .catch(() => undefined);
  }, [profile]);

  const chf = parseChf(input);
  const valid = chf > 0 && price !== undefined;
  const chfOf = (units: bigint | undefined) => (units === undefined || !price ? "…" : formatChf(chfForUsdc(units, price.usdcChf)));

  async function next() {
    if (!price) return;
    setBusy(true);
    setError(undefined);
    try {
      onReady(await prepareUsdcPayment(profile, contact, usdcForChf(chf, price.usdcChf)));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      actions={
        <>
          <button className="button" onClick={next} disabled={!valid || busy}>
            {busy ? "Preparing…" : "Continue"}
          </button>
          <button className="button quiet" onClick={onBack}>
            Choose someone else
          </button>
        </>
      }
    >
      <h1>How much for {contact.name}?</h1>
      <label className="amount-entry">
        <span>CHF</span>
        <input
          inputMode="decimal"
          autoFocus
          placeholder="0.00"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label={`Amount in Swiss francs for ${contact.name}, paid in USDC`}
        />
      </label>
      {valid && <p className="small muted tabular">About {formatUsdc(usdcForChf(chf, price.usdcChf))}</p>}
      <dl className="slip-details" style={{ padding: 0, border: 0 }}>
        <dt>USDC</dt>
        <dd>{chfOf(balance)}</dd>
        <dt>Face ID alone, today</dt>
        <dd>{chfOf(today)}</dd>
      </dl>
      <p className="small muted">
        Up to your daily limit, only your Face ID is needed: your account on Base checks it itself. Above it, Swissquote
        checks the payment and co-signs it.
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
    </Screen>
  );
}

function UsdcSlip({ payment }: { payment: UsdcPayment }) {
  const price = usePrice();
  const { contact, amount, fee } = payment;
  const feeUnits = BigInt(fee.feeUsdc);
  const chf = (units: bigint) => (price ? formatChf(chfForUsdc(units, price.usdcChf)) : "…");
  return (
    <section className="slip" aria-label="Payment details">
      <div className="slip-head">
        <span className="muted">You send to {contact.name}</span>
        <span className="slip-amount">{chf(amount)}</span>
        <span className="small muted tabular">{formatUsdc(amount)}</span>
      </div>
      <dl className="slip-details">
        <dt>To</dt>
        <dd>
          {contact.name}
          {contact.relation && ` (${contact.relation})`}
        </dd>
        <dt>From</dt>
        <dd>USDC</dd>
        <dt>Network fee</dt>
        <dd>
          {fee.paidBy === "swissquote"
            ? `${formatChf(fee.feeChf)}, paid by Swissquote`
            : `${chf(feeUnits)} (${formatUsdc(feeUnits)}), paid by you`}
        </dd>
        <dt>You pay in total</dt>
        <dd>{chf(amount + feeUnits)}</dd>
      </dl>
    </section>
  );
}

export function UsdcConfirm({
  profile,
  payment,
  onCancel,
  onSent,
}: {
  profile: WalletProfile;
  payment: UsdcPayment;
  onCancel: () => void;
  onSent: (sent: EthSent) => void;
}) {
  const price = usePrice();
  const [sending, setSending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<{ text: string; txHash?: string }>();
  const { review } = payment;
  const blocked = review?.verdict === "BLOCKED";
  const needsConfirmation = review?.verdict === "NEEDS_CONFIRMATION";

  async function confirm() {
    setError(undefined);
    setSending(true);
    try {
      onSent(await sendUsdcPayment(profile, payment, confirmed));
    } catch (err) {
      setError({ text: (err as Error).message, txHash: err instanceof OperationFailedError ? err.sent.txHash : undefined });
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
              <button className="button" onClick={confirm} disabled={sending}>
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
      <UsdcSlip payment={payment} />
      {payment.signer === "passkey" ? (
        <p className="small muted">
          Only your Face ID is needed: {payment.contact.name} is an approved contact and this is within your daily limit.
          Your account on Base checks both itself. Swissquote does not sign it.
        </p>
      ) : (
        !blocked && (
          <p className="small muted">
            This is more than Face ID alone can pay today ({price ? formatChf(chfForUsdc(payment.remainingToday, price.usdcChf)) : "…"}{" "}
            left), so Swissquote checks it and co-signs it with your Face ID.
          </p>
        )
      )}
      {review && (
        <div className={`notice ${review.verdict === "APPROVE" ? "ok" : blocked ? "error" : "warn"}`} role="status">
          <p className="protected" style={{ color: "inherit" }}>
            <ShieldIcon size={20} />
            {review.verdict === "APPROVE" ? "Checked by Swissquote" : blocked ? "Stopped by Swissquote" : "Swissquote asks you to check"}
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
              <a className="small" href={explorer.baseTx(error.txHash)} target="_blank" rel="noreferrer">
                View {shortId(error.txHash)} on Base
              </a>
            </>
          )}
        </p>
      )}
    </Screen>
  );
}

export function UsdcSent({ payment, sent }: { payment: UsdcPayment; sent: EthSent }) {
  return (
    <Screen
      actions={
        <Link href="/" className="button">
          Back to my safe
        </Link>
      }
    >
      <h1>Sent to {payment.contact.name}</h1>
      <UsdcSlip payment={payment} />
      <p className="notice ok">
        {payment.contact.name} has received it: Base confirms payments within seconds.
        <br />
        <a className="small" href={explorer.baseTx(sent.txHash)} target="_blank" rel="noreferrer">
          View payment {shortId(sent.txHash)} on Base
        </a>
      </p>
    </Screen>
  );
}
