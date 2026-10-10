"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InsufficientFundsError, chfToSats, type PocketPayment } from "@sqw/bitcoin";
import { DEMO_CONTACTS, explorer, type Contact } from "@sqw/shared";
import { FaceIcon } from "../../components/icons";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { formatBtc, formatSatsAsChf, shortId } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usePrice } from "../../lib/use-price";
import { pocketAvailable, preparePocketPayment, sendFromPocket } from "../../lib/wallet-bitcoin";

export default function SendPage() {
  return <RequireWallet>{(profile) => <Send profile={profile} />}</RequireWallet>;
}

type Step =
  | { name: "contact" }
  | { name: "amount"; contact: Contact }
  | { name: "confirm"; contact: Contact; payment: PocketPayment }
  | { name: "sending"; contact: Contact; payment: PocketPayment }
  | { name: "sent"; contact: Contact; payment: PocketPayment; txid: string };

function Send({ profile }: { profile: WalletProfile }) {
  const [step, setStep] = useState<Step>({ name: "contact" });
  const [error, setError] = useState<string>();
  const go = (next: Step) => {
    setError(undefined);
    setStep(next);
  };

  if (step.name === "contact") {
    return (
      <Screen back={{ href: "/" }}>
        <h1>Who do you want to pay?</h1>
        <ul className="rows">
          {DEMO_CONTACTS.map((c) => (
            <li key={c.id}>
              <button className="row" onClick={() => go({ name: "amount", contact: c })}>
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
        <p className="small muted">To pay someone new, Swissquote first checks them for you. This comes in the next version of the prototype.</p>
      </Screen>
    );
  }

  if (step.name === "amount") {
    return (
      <AmountStep
        profile={profile}
        contact={step.contact}
        onBack={() => go({ name: "contact" })}
        onReady={(payment) => go({ name: "confirm", contact: step.contact, payment })}
      />
    );
  }

  if (step.name === "confirm" || step.name === "sending") {
    const { contact, payment } = step;
    const sending = step.name === "sending";
    async function confirm() {
      setError(undefined);
      setStep({ name: "sending", contact, payment });
      try {
        const txid = await sendFromPocket(profile, payment);
        setStep({ name: "sent", contact, payment, txid });
      } catch (err) {
        setError((err as Error).message);
        setStep({ name: "confirm", contact, payment });
      }
    }
    return (
      <Screen
        actions={
          <>
            <button className="button" onClick={confirm} disabled={sending}>
              <FaceIcon /> {sending ? "Sending…" : "Confirm with Face ID"}
            </button>
            <button className="button secondary" onClick={() => go({ name: "contact" })} disabled={sending}>
              Cancel
            </button>
          </>
        }
      >
        <h1>Check your payment</h1>
        <PaymentSlip contact={contact} payment={payment} />
        <p className="small muted">Payments from your Spending pocket only need your Face ID. Swissquote does not sign them.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  return (
    <Screen
      actions={
        <Link href="/" className="button">
          Back to my safe
        </Link>
      }
    >
      <h1>Sent to {step.contact.name}</h1>
      <PaymentSlip contact={step.contact} payment={step.payment} />
      <p className="notice ok">
        Your payment is on the Bitcoin network. It usually arrives within 10 minutes.
        <br />
        <span className="small">Reference {shortId(step.txid)}</span>
      </p>
      <a className="button secondary" href={explorer.btcTx(step.txid)} target="_blank" rel="noreferrer">
        View on the Bitcoin network
      </a>
    </Screen>
  );
}

function PaymentSlip({ contact, payment }: { contact: Contact; payment: PocketPayment }) {
  const price = usePrice();
  return (
    <section className="slip" aria-label="Payment details">
      <div className="slip-head">
        <span className="muted">You send to {contact.name}</span>
        <span className="slip-amount">{formatSatsAsChf(payment.amount, price?.btcChf)}</span>
        <span className="small muted tabular">{formatBtc(payment.amount)}</span>
      </div>
      <dl className="slip-details">
        <dt>To</dt>
        <dd>
          {contact.name} ({contact.relation})
        </dd>
        <dt>From</dt>
        <dd>Spending pocket</dd>
        <dt>Network fee</dt>
        <dd>
          {formatSatsAsChf(payment.fee, price?.btcChf)}, paid by you
        </dd>
        <dt>Total</dt>
        <dd>{formatSatsAsChf(payment.amount + payment.fee, price?.btcChf)}</dd>
      </dl>
    </section>
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
  onReady: (payment: PocketPayment) => void;
}) {
  const price = usePrice();
  const [input, setInput] = useState("");
  const [available, setAvailable] = useState<bigint>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pocketAvailable(profile)
      .then(setAvailable)
      .catch(() => setError("Your Spending pocket balance could not be loaded. Try again in a moment."));
  }, [profile]);

  const chf = parseChf(input);
  const valid = chf > 0 && price !== undefined;

  async function next() {
    if (!price) return;
    setBusy(true);
    setError(undefined);
    try {
      onReady(await preparePocketPayment(profile, contact, chfToSats(chf, price.btcChf)));
    } catch (err) {
      setError(
        err instanceof InsufficientFundsError
          ? `That is more than your Spending pocket holds (${formatSatsAsChf(err.available, price.btcChf)} available). Larger payments will go through your Savings safe with Swissquote's check.`
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
          aria-label={`Amount in Swiss francs for ${contact.name}`}
        />
      </label>
      <p className="muted">
        Available in your Spending pocket:{" "}
        <strong className="tabular">{available === undefined ? "…" : formatSatsAsChf(available, price?.btcChf)}</strong>
      </p>
      {valid && <p className="small muted tabular">About {formatBtc(chfToSats(chf, price.btcChf))}</p>}
      {chf > 0 && price === undefined && <p className="small muted">Loading the bitcoin price…</p>}
      {error && <p className="notice error" role="alert">{error}</p>}
      {available === 0n && (
        <p className="notice">
          Your Spending pocket is empty. <Link href="/receive">Add bitcoin</Link> first.
        </p>
      )}
    </Screen>
  );
}
