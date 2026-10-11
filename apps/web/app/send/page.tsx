"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { InsufficientFundsError, chfToSats, satsToChf } from "@sqw/bitcoin";
import { chfForUsdc } from "@sqw/ethereum";
import type { Contact } from "@sqw/shared";
import { Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { formatBtc, formatChf, formatSatsAsChf } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook } from "../../lib/rules";
import { usePrice } from "../../lib/use-price";
import {
  NotEnoughInOnePocketError,
  available,
  preparePayment,
  type PaymentResult,
  type PreparedPayment,
} from "../../lib/wallet-bitcoin";
import { loadUsdcBalance } from "../../lib/wallet-usdc";
import { BitcoinConfirm, BitcoinSent } from "./bitcoin";
import { UsdcSend } from "./usdc";
import { BtcToken, UsdcToken } from "../../components/tokens";

export default function SendPage() {
  return <RequireWallet>{(profile) => <Send profile={profile} />}</RequireWallet>;
}

type Step =
  | { name: "contact" }
  /** The contact can receive bitcoin and USDC: the client chooses. */
  | { name: "asset"; contact: Contact }
  | { name: "usdc"; contact: Contact }
  | { name: "amount"; contact: Contact }
  | { name: "confirm"; payment: PreparedPayment }
  | { name: "sent"; payment: PreparedPayment; result: PaymentResult };

/** Asks for the asset only when the contact can receive both. */
function firstStepFor(contact: Contact): Step {
  if (contact.btcAddress && contact.ethAddress) return { name: "asset", contact };
  return contact.ethAddress ? { name: "usdc", contact } : { name: "amount", contact };
}

function Send({ profile }: { profile: WalletProfile }) {
  const [step, setStep] = useState<Step>({ name: "contact" });

  switch (step.name) {
    case "contact":
      return <ContactStep profile={profile} onPick={(contact) => setStep(firstStepFor(contact))} />;
    case "asset":
      return (
        <AssetStep
          profile={profile}
          contact={step.contact}
          onBack={() => setStep({ name: "contact" })}
          onPick={(asset) => setStep(asset === "USDC" ? { name: "usdc", contact: step.contact } : { name: "amount", contact: step.contact })}
        />
      );
    case "usdc":
      return <UsdcSend profile={profile} contact={step.contact} onBack={() => setStep({ name: "contact" })} />;
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
        <BitcoinConfirm
          profile={profile}
          payment={step.payment}
          onCancel={() => setStep({ name: "contact" })}
          onSent={(result) => setStep({ name: "sent", payment: step.payment, result })}
        />
      );
    case "sent":
      return <BitcoinSent payment={step.payment} result={step.result} />;
  }
}

/** The approved contacts from the rulebook (Swissquote's copy, or this phone's when Swissquote is offline). */
function ContactStep({ profile, onPick }: { profile: WalletProfile; onPick: (contact: Contact) => void }) {
  const [contacts, setContacts] = useState<Contact[]>();
  useEffect(() => {
    loadRulebook(profile.walletId).then((rb) => setContacts(rb.contacts));
  }, [profile]);

  return (
    <Screen tabs>
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
        become a contact after a waiting period. You can also <Link href="/assistant">ask the assistant</Link>.
      </p>
    </Screen>
  );
}

/** Bitcoin or USDC, with what each can pay. */
function AssetStep({
  profile,
  contact,
  onBack,
  onPick,
}: {
  profile: WalletProfile;
  contact: Contact;
  onBack: () => void;
  onPick: (asset: "BTC" | "USDC") => void;
}) {
  const price = usePrice();
  const [btc, setBtc] = useState<bigint>();
  const [usdc, setUsdc] = useState<bigint | string>();

  useEffect(() => {
    available(profile)
      .then((a) => setBtc(a.pocket > a.savings ? a.pocket : a.savings))
      .catch(() => undefined);
    loadUsdcBalance(profile)
      .then(setUsdc)
      .catch((err) => setUsdc((err as Error).message));
  }, [profile]);

  return (
    <Screen
      back={{ href: "/send" }}
      actions={
        <button className="button quiet" onClick={onBack}>
          Choose someone else
        </button>
      }
    >
      <h1>What do you want to send to {contact.name}?</h1>
      <ul className="rows">
        <li>
          <button className="row" onClick={() => onPick("BTC")}>
            <BtcToken size={40} />
            <span className="row-main">
              <span className="row-title">Bitcoin</span>
              <br />
              <span className="small muted">From your Spending pocket or Savings safe</span>
            </span>
            <span className="row-amount">{btc === undefined || !price ? "…" : formatChf(satsToChf(btc, price.btcChf))}</span>
          </button>
        </li>
        <li>
          <button className="row" onClick={() => onPick("USDC")} disabled={typeof usdc === "string"}>
            <UsdcToken size={40} />
            <span className="row-main">
              <span className="row-title">USDC</span>
              <br />
              <span className="small muted">{typeof usdc === "string" ? usdc : "USDC, arrives within seconds"}</span>
            </span>
            <span className="row-amount">{typeof usdc !== "bigint" || !price ? "…" : formatChf(chfForUsdc(usdc, price.usdcChf))}</span>
          </button>
        </li>
      </ul>
      <p className="small muted">Amounts are what you can send in one payment.</p>
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
