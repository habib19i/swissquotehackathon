"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO_CLIENT, explorer, type RecoveryRequest, type WalletRecord } from "@sqw/shared";
import { Countdown, DemoModeNote } from "../../components/countdown";
import { FaceIcon, ShieldIcon } from "../../components/icons";
import { KeyHolders } from "../../components/keyholders";
import { Mock, Screen } from "../../components/screen";
import { useWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { setUpFaceId } from "../../lib/create-wallet";
import { shortId } from "../../lib/format";
import type { WalletPasskey } from "../../lib/passkey";
import { saveClient, type Client } from "../../lib/profile";
import { provider } from "../../lib/provider";
import { beginRecovery, completeRecovery, faceCheck, verifyRecovery } from "../../lib/recover";

type Step = "identify" | "face-id" | "recovery-key" | "face-check" | "refused" | "waiting" | "cancelled" | "restoring" | "done";

/** "I lost my phone" (screen 8, CLAUDE.md section 8), on the new phone. */
export default function RecoverPage() {
  const router = useRouter();
  const { client: loggedIn, reload } = useWallet();
  const [step, setStep] = useState<Step>("identify");
  const [error, setError] = useState<string>();
  const [clientNumber, setClientNumber] = useState(DEMO_CLIENT.clientNumber);
  const [record, setRecord] = useState<WalletRecord>();
  const [faceId, setFaceId] = useState<{ passkey: WalletPasskey; prfSecret?: Uint8Array }>();
  const [pending, setPending] = useState<{ recovery: RecoveryRequest; requestId: string; assertion: unknown }>();
  const [recovery, setRecovery] = useState<RecoveryRequest & { ready?: boolean }>();
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<{ sweepTxid?: string; sweepError?: string }>();
  const client: Client = { name: loggedIn?.name ?? DEMO_CLIENT.name, clientNumber: clientNumber.trim() };

  useEffect(() => {
    if (loggedIn) setClientNumber(loggedIn.clientNumber);
  }, [loggedIn]);

  // During the waiting period, follow the provider: the real client may cancel from another device.
  useEffect(() => {
    if (step !== "waiting" || !recovery) return;
    const timer = setInterval(async () => {
      const latest = await provider.recovery(recovery.id).catch(() => undefined);
      if (!latest) return;
      setRecovery(latest);
      if (latest.status === "cancelled") setStep("cancelled");
    }, 2_000);
    return () => clearInterval(timer);
  }, [step, recovery]);

  async function attempt(action: () => Promise<void>) {
    setError(undefined);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const identify = () =>
    attempt(async () => {
      setRecord(await cosigner.walletOfClient(client.clientNumber));
      await saveClient(client);
      setStep("face-id");
    });

  const newFaceId = () =>
    attempt(async () => {
      setFaceId(await setUpFaceId(client));
      setStep("recovery-key");
    });

  const presentKey = () =>
    attempt(async () => {
      setPending(await beginRecovery(record!.walletId));
      setStep("face-check");
    });

  const runFaceCheck = () =>
    attempt(async () => {
      // MOCK: a real liveness check compares the client's face with their KYC photo at Swissquote.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      const attestation = await faceCheck(record!.walletId, pending!.recovery.id, "match");
      const verified = await verifyRecovery(pending!.recovery.id, pending!.requestId, pending!.assertion, attestation);
      setRecovery(verified);
      setStep(verified.status === "waiting-period" ? "waiting" : "refused");
    });

  async function restore() {
    setError(undefined);
    setStep("restoring");
    try {
      setResult(await completeRecovery(client, record!, recovery!.id, faceId!.passkey, faceId!.prfSecret, setRound));
      setStep("done");
    } catch (err) {
      setError((err as Error).message);
      setStep("waiting");
    }
  }

  if (step === "identify") {
    return (
      <Screen back={{ href: "/login" }} actions={<button className="button" onClick={identify}>Continue</button>}>
        <h1>Bring your safe to this phone</h1>
        <p className="lead">Lost or stolen phone? Your safe is not lost. First, log in to your Swissquote account on this new phone.</p>
        <div className="field">
          <label htmlFor="recover-client">Client number</label>
          <input id="recover-client" className="input tabular" value={clientNumber} onChange={(e) => setClientNumber(e.target.value)} />
        </div>
        <p className="small muted">
          <Mock /> The Swissquote login is simulated.
        </p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  if (step === "face-id") {
    return (
      <Screen actions={<button className="button" onClick={newFaceId}><FaceIcon /> Use Face ID</button>}>
        <h1>Lock this phone with your face</h1>
        <p className="lead">This new phone gets its own Face ID key. Your old phone&rsquo;s key will stop working.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  if (step === "recovery-key") {
    return (
      <Screen actions={<button className="button" onClick={presentKey}>Use my recovery key</button>}>
        <h1>Show your recovery key</h1>
        <p className="lead">
          The security key Swissquote sent you, or the passkey you chose as your recovery key. Only you have it, so only you
          can move your safe.
        </p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  if (step === "face-check") {
    return (
      <Screen actions={<button className="button" onClick={runFaceCheck}>Start the face check</button>}>
        <h1>A quick face check</h1>
        <p className="lead">Swissquote compares your face with the photo from when you opened your account.</p>
        <div className="face-scan" aria-hidden="true">
          <FaceIcon size={72} />
        </div>
        <p className="small muted">
          <Mock /> The face check is simulated in this prototype; Swissquote signs its result for the recovery provider.
        </p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  if (step === "refused") {
    return (
      <Screen actions={<button className="button" onClick={() => router.replace("/login")}>Back</button>}>
        <h1>Recovery refused</h1>
        <div className="notice error">
          {recovery?.reasons?.map((r) => (
            <p key={r}>{r}</p>
          ))}
        </div>
        <p className="muted">The client was alerted on every channel.</p>
      </Screen>
    );
  }

  if (step === "waiting" || step === "restoring") {
    const ready = recovery?.ready || (recovery?.waitUntil !== undefined && Date.parse(recovery.waitUntil) <= Date.now());
    return (
      <Screen
        actions={
          step === "waiting" && (
            <button className="button" onClick={restore} disabled={!ready}>
              {ready ? "Bring my safe back" : "Waiting…"}
            </button>
          )
        }
      >
        <h1>{step === "restoring" ? "Bringing your safe back" : "Your safe is on its way"}</h1>
        {step === "waiting" && recovery?.waitUntil && (
          <p className="lead">
            For your protection, your safe moves in <Countdown until={recovery.waitUntil} onDone={() => setRecovery({ ...recovery, ready: true })} />.{" "}
            <DemoModeNote production="48 hours" />
          </p>
        )}
        {step === "waiting" && (
          <p className="notice">
            <ShieldIcon size={20} /> Swissquote alerted you on every channel. If this was not you, you can cancel from any device.
          </p>
        )}
        {step === "restoring" && (
          <>
            <KeyHolders ready={[false, true, true]} light />
            <p className="muted" aria-live="polite">
              Swissquote and the independent safe-keeper are making a new piece for this phone{round > 0 && `: step ${round} of 4`}…
            </p>
          </>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  if (step === "cancelled") {
    return (
      <Screen actions={<button className="button" onClick={() => router.replace("/login")}>Back</button>}>
        <h1>Recovery cancelled</h1>
        <p className="lead">Someone cancelled this recovery from another device. Your safe stays where it was.</p>
      </Screen>
    );
  }

  return (
    <Screen
      actions={
        <button
          className="button"
          onClick={async () => {
            await reload();
            router.replace("/");
          }}
        >
          Go to my safe
        </button>
      }
    >
      <h1>Your safe is back</h1>
      <KeyHolders ready={[true, true, true]} light />
      <p className="lead">This phone now holds your piece of the key. Your old phone&rsquo;s piece no longer works, and your bitcoin never moved.</p>
      {result?.sweepTxid && (
        <p className="notice ok">
          Your old Spending pocket is moving to this phone&rsquo;s new pocket.
          <br />
          <a className="small" href={explorer.btcTx(result.sweepTxid)} target="_blank" rel="noreferrer">
            View {shortId(result.sweepTxid)} on the Bitcoin network
          </a>
        </p>
      )}
      {result?.sweepError && <p className="notice">Your old Spending pocket could not be moved yet: {result.sweepError}</p>}
    </Screen>
  );
}
