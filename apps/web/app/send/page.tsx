"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InsufficientFundsError, chfToSats } from "@sqw/bitcoin";
import { explorer, type Contact } from "@sqw/shared";
import { FaceIcon, ShieldIcon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { formatBtc, formatSatsAsChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook } from "../../lib/rules";
import { usePrice } from "../../lib/use-price";
import {
  NotEnoughInOnePocketError,
  available,
  preparePayment,
  sendPayment,
  type PaymentResult,
  type PreparedPayment,
} from "../../lib/wallet-bitcoin";

export default function SendPage() {
  return <RequireWallet>{(profile) => <Send profile={profile} />}</RequireWallet>;
}

type Step =
  | { name: "contact" }
  | { name: "amount"; contact: Contact }
  | { name: "confirm"; payment: PreparedPayment }
  | { name: "sent"; payment: PreparedPayment; result: PaymentResult };

function Send({ profile }: { profile: WalletProfile }) {
  const [step, setStep] = useState<Step>({ name: "contact" });

  switch (step.name) {
    case "contact":
      return <ContactStep profile={profile} onPick={(contact) => setStep({ name: "amount", contact })} />;
    case "amount":
      return (
        <AmountStep
          profile={profile}
          contact={step.contact}
          onBack={() => setStep({ name: "contact" })}
          onReady={(payment) => setStep({ name: "confirm", payment })}
        />
      );
    case "confirm":
      return (
        <ConfirmStep
          profile={profile}
          payment={step.payment}
          onCancel={() => setStep({ name: "contact" })}
          onSent={(result) => setStep({ name: "sent", payment: step.payment, result })}
        />
      );
    case "sent":
      return <SentStep payment={step.payment} result={step.result} />;
  }
}

/** The approved contacts from the rulebook (Swissquote's copy, or this phone's when Swissquote is offline). */
function ContactStep({ profile, onPick }: { profile: WalletProfile; onPick: (contact: Contact) => void }) {
  const [contacts, setContacts] = useState<Contact[]>();
  useEffect(() => {
    loadRulebook(profile.walletId).then((rb) => setContacts(rb.contacts));
  }, [profile]);

  return (
    <Screen back={{ href: "/" }}>
      <h1>Who do you want to pay?</h1>
      <ul className="rows">
        {contacts?.length === 0 && <li className="row muted">You have no contacts yet.</li>}
        {contacts?.map((c) => (
          <li key={c.id}>
            <button className="row" onClick={() => onPick(c)}>
              <span className="avatar" aria-hidden="true">
                {c.name[0]}
              </span>
              <span className="row-main">
                <span className="row-title">{c.name}</span>
                <br />
                <span className="small muted">{c.relation}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted">
        To pay someone new, <Link href="/rules">add them as a contact</Link>. Swissquote checks them for you, and they
        become a contact after a waiting period.
      </p>
    </Screen>
  );
}

function parseChf(input: string): number {
  const value = Number(input.replace(",", ".").replace(/['’\s]/g, ""));
  return Number.isFinite(value) ? value : NaN;
}

function AmountStep({
  profile,
  contact,
  onBack,
  onReady,
}: {
  profile: WalletProfile;
  contact: Contact;
  onBack: () => void;
  onReady: (payment: PreparedPayment) => void;
}) {
  const price = usePrice();
  const [input, setInput] = useState("");
  const [funds, setFunds] = useState<{ pocket: bigint; savings: bigint }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    available(profile)
      .then(setFunds)
      .catch(() => setError("Your balances could not be loaded. Try again in a moment."));
  }, [profile]);

  const chf = parseChf(input);
  const valid = chf > 0 && price !== undefined;

  async function next(from?: "savings") {
    if (!price) return;
    setBusy(true);
    setError(undefined);
    const chfOf = (sats: bigint) => formatSatsAsChf(sats, price.btcChf);
    try {
      onReady(await preparePayment(profile, contact, chfToSats(chf, price.btcChf), from));
    } catch (err) {
      setError(
        err instanceof NotEnoughInOnePocketError
          ? `A payment comes from one pocket at a time. Your Spending pocket can pay up to ${chfOf(err.pocketMax)} and your Savings safe up to ${chfOf(err.savingsMax)}.`
          : err instanceof InsufficientFundsError
            ? `Your Savings safe can pay up to ${chfOf(err.available)}.`
            : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      actions={
        <>
          <button className="button" onClick={() => next()} disabled={!valid || busy}>
            {busy ? "Preparing…" : "Continue"}
          </button>
          <button className="button secondary" onClick={() => next("savings")} disabled={!valid || busy}>
            Pay from my Savings safe
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
          aria-label={`Amount in Swiss francs for ${contact.name}`}
        />
      </label>
      {valid && <p className="small muted tabular">About {formatBtc(chfToSats(chf, price.btcChf))}</p>}
      <dl className="slip-details" style={{ padding: 0, border: 0 }}>
        <dt>Spending pocket</dt>
        <dd>{funds ? formatSatsAsChf(funds.pocket, price?.btcChf) : "…"}</dd>
        <dt>Savings safe</dt>
        <dd>{funds ? formatSatsAsChf(funds.savings, price?.btcChf) : "…"}</dd>
      </dl>
      <p className="small muted">
        Up to your Spending pocket&rsquo;s balance, only your Face ID is needed. Larger payments come from your Savings
        safe, after Swissquote&rsquo;s check.
      </p>
      {error && <p className="notice error" role="alert">{error}</p>}
    </Screen>
  );
}

function ConfirmStep({
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

function SentStep({ payment, result }: { payment: PreparedPayment; result: PaymentResult }) {
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
