"use client";

import { useEffect, useState } from "react";
import { chfToSats } from "@sqw/bitcoin";
import { DEMO_ATTACKER_BTC_ADDRESS, type PendingChange } from "@sqw/shared";
import { Countdown } from "../../../components/countdown";
import { Mock, Screen } from "../../../components/screen";
import { RequireWallet } from "../../../components/wallet-context";
import { cosigner } from "../../../lib/cosigner";
import { formatChf, formatSatsAsChf } from "../../../lib/format";
import type { WalletProfile } from "../../../lib/profile";
import { faceCheck, verifyRecovery } from "../../../lib/recover";
import { provider } from "../../../lib/provider";
import { requestChange } from "../../../lib/rules";
import { usePrice } from "../../../lib/use-price";
import { available } from "../../../lib/wallet-bitcoin";

export default function AttackerPage() {
  return <RequireWallet>{(profile) => <Attacker profile={profile} />}</RequireWallet>;
}

type Outcome = { verdict: "refused" | "allowed" | "pending"; lines: string[] };

const THIEF = { id: "attacker", name: "Mr. Smith (the thief)", btcAddress: DEMO_ATTACKER_BTC_ADDRESS };

/**
 * Attacker mode (CLAUDE.md section 8): the thief holds the unlocked phone AND the client's email.
 * Each attempt calls the real services; the screen shows each refusal and why, in plain language.
 */
function Attacker({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [busy, setBusy] = useState<string>();
  const [contactChange, setContactChange] = useState<PendingChange>();
  const [maxLoss, setMaxLoss] = useState<bigint>();

  const record = (step: string, outcome: Outcome) => setOutcomes((o) => ({ ...o, [step]: outcome }));

  async function attempt(step: string, action: () => Promise<Outcome>) {
    setBusy(step);
    try {
      record(step, await action());
    } catch (err) {
      record(step, { verdict: "refused", lines: [(err as Error).message] });
    } finally {
      setBusy(undefined);
    }
  }

  // Follow the thief's new contact: the real client cancels it from their other device.
  useEffect(() => {
    if (!contactChange || contactChange.status !== "pending") return;
    const timer = setInterval(async () => {
      const latest = (await cosigner.changes(profile.walletId)).find((c) => c.id === contactChange.id);
      if (latest && latest.status !== "pending") {
        setContactChange(latest);
        record("contact", {
          verdict: latest.status === "cancelled" ? "refused" : "allowed",
          lines:
            latest.status === "cancelled"
              ? ["The real client saw the alert and cancelled it from their other device. The thief is not a contact."]
              : ["Nobody cancelled in time, so the thief became a contact. In real life the client has 24 hours to react."],
        });
      }
    }, 2_000);
    return () => clearInterval(timer);
  }, [contactChange, profile]);

  const steps = [
    {
      id: "send",
      title: `Send ${formatChf(5_000)} to himself`,
      run: () =>
        attempt("send", async () => {
          if (!price) throw new Error("Waiting for the bitcoin price.");
          const result = await cosigner.shield(profile.walletId, DEMO_ATTACKER_BTC_ADDRESS, chfToSats(5_000, price.btcChf));
          return { verdict: result.verdict === "BLOCKED" ? "refused" : "allowed", lines: [`Swissquote: ${result.verdict}.`, ...result.reasons] };
        }),
    },
    {
      id: "contact",
      title: "Add himself as a contact",
      run: () =>
        attempt("contact", async () => {
          const id = await requestChange(profile, { kind: "addContact", contact: { ...THIEF, id: `attacker-${Date.now().toString(36)}` } });
          const change = (await cosigner.changes(profile.walletId)).find((c) => c.id === id);
          setContactChange(change);
          return {
            verdict: "pending",
            lines: [
              "Swissquote accepted the request but holds it for 24 hours, and alerted the real client on every channel, including the email the thief can read.",
              "Now open the client's other device and cancel it.",
            ],
          };
        }),
    },
    {
      id: "limits",
      title: "Take whatever the rules allow",
      run: () =>
        attempt("limits", async () => {
          const { pocket } = await available(profile);
          setMaxLoss(pocket);
          return {
            verdict: "allowed",
            lines: [
              `He can spend the Spending pocket: at most ${formatSatsAsChf(pocket, price?.btcChf)} today, never more than its size of ${formatChf(100)}.`,
              "Everything in the Savings safe needs Swissquote's check, which stops new recipients and large amounts.",
            ],
          };
        }),
    },
    {
      id: "recovery",
      title: "Move the safe to his own phone",
      run: () =>
        attempt("recovery", async () => {
          const { recovery, requestId } = await provider.startRecovery(profile.walletId);
          // The thief has no recovery key (it is at the client's home) and is not the client in the face check.
          const attestation = await faceCheck(profile.walletId, recovery.id, "no-match");
          const result = await verifyRecovery(recovery.id, requestId, undefined, attestation);
          return { verdict: result.status === "refused" ? "refused" : "allowed", lines: result.reasons ?? ["The recovery went through."] };
        }),
    },
  ];

  return (
    <Screen back={{ href: "/demo", label: "Demo panel" }}>
      <h1>
        Attacker mode <Mock>Demo</Mock>
      </h1>
      <p className="lead">
        A thief has your unlocked phone and can read your email. Try what he would try. Every attempt goes to the real
        Swissquote and recovery services.
      </p>
      <a href="/e-banking" target="_blank" rel="noreferrer" className="button secondary">
        Open the client&rsquo;s other device
      </a>

      <ol className="rows attack-steps">
        {steps.map((step) => {
          const outcome = outcomes[step.id];
          return (
            <li key={step.id} className="row" style={{ display: "block" }}>
              <p className="row-title">{step.title}</p>
              {outcome ? (
                <div className={`notice ${outcome.verdict === "refused" ? "ok" : outcome.verdict === "pending" ? "warn" : ""}`} style={{ marginTop: 8 }}>
                  <p className="row-title">
                    {outcome.verdict === "refused" ? "Stopped" : outcome.verdict === "pending" ? "On hold" : "Allowed, within limits"}
                  </p>
                  {outcome.lines.map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                  {step.id === "contact" && contactChange?.status === "pending" && (
                    <p className="small">
                      Takes effect in <Countdown until={contactChange.effectiveAt} /> unless the client cancels.
                    </p>
                  )}
                </div>
              ) : (
                <button className="button secondary" style={{ marginTop: 8 }} onClick={step.run} disabled={busy !== undefined}>
                  {busy === step.id ? "Trying…" : "Try it"}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {maxLoss !== undefined && (
        <p className="small muted">Worst case for the client today: the Spending pocket, {formatSatsAsChf(maxLoss, price?.btcChf)}.</p>
      )}
    </Screen>
  );
}
