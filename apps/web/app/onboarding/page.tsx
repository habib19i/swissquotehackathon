"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FaceIcon } from "../../components/icons";
import { KeyHolders } from "../../components/keyholders";
import { ProtectedBySwissquote, Screen } from "../../components/screen";
import { useWallet } from "../../components/wallet-context";
import { createSafe, setUpFaceId } from "../../lib/create-wallet";
import { passkeysSupported, type WalletPasskey } from "../../lib/passkey";
import type { WalletProfile } from "../../lib/profile";

type Step = "intro" | "face-id" | "creating" | "ready";

/** Onboarding (CLAUDE.md section 8): Open my safe, Face ID, key creation, ready. */
export default function OnboardingPage() {
  const router = useRouter();
  const { loading, client, profile, reload } = useWallet();
  const [step, setStep] = useState<Step>("intro");
  const [error, setError] = useState<string>();
  const [faceId, setFaceId] = useState<{ passkey: WalletPasskey; prfSecret?: Uint8Array }>();
  const [round, setRound] = useState(0);
  const [created, setCreated] = useState<WalletProfile>();

  useEffect(() => {
    if (loading) return;
    if (!client) router.replace("/login");
    else if (profile && step !== "ready") router.replace("/");
  }, [loading, client, profile, step, router]);

  async function enableFaceId() {
    setError(undefined);
    if (!passkeysSupported()) {
      setError("This browser cannot use Face ID here. Open the app over https or on localhost.");
      return;
    }
    try {
      const result = await setUpFaceId(client!);
      setFaceId(result);
      await create(result);
    } catch (err) {
      setError(`Face ID was not set up: ${(err as Error).message}`);
    }
  }

  async function create(credentials = faceId!) {
    setError(undefined);
    setStep("creating");
    setRound(0);
    try {
      const result = await createSafe(client!, credentials.passkey, credentials.prfSecret, (n) => setRound(n));
      setCreated(result);
      setStep("ready");
    } catch (err) {
      setError(`Your safe could not be created: ${(err as Error).message}`);
    }
  }

  if (step === "intro") {
    return (
      <Screen actions={<button className="button" onClick={() => setStep("face-id")}>Open my safe</button>}>
        <h1>Open your own safe</h1>
        <p className="lead">
          A safe for your bitcoin and digital dollars that only you can open, with your face. Swissquote watches over
          it, but can never open it alone.
        </p>
        <ProtectedBySwissquote />
      </Screen>
    );
  }

  if (step === "face-id") {
    return (
      <Screen
        actions={
          <button className="button" onClick={enableFaceId}>
            <FaceIcon /> Use Face ID
          </button>
        }
      >
        <h1>Lock it with your face</h1>
        <p className="lead">Face ID will be the only key you need. No password, nothing to write down.</p>
        {error && <p className="notice error" role="alert">{error}</p>}
      </Screen>
    );
  }

  if (step === "creating") {
    return (
      <Screen
        actions={
          error && (
            <button className="button" onClick={() => create()}>
              Try again
            </button>
          )
        }
      >
        <h1>Creating your safe</h1>
        <p className="lead">
          Your key is made in three pieces, for three different holders. Nobody, not even Swissquote, ever holds the
          whole key.
        </p>
        <KeyHolders ready={[false, false, false]} light />
        {!error && (
          <p className="muted" aria-live="polite">
            {round === 0 ? "Connecting to Swissquote and the safe-keeper…" : `Making the pieces: step ${round} of 4`}
          </p>
        )}
        {error && <p className="notice error" role="alert">{error}</p>}
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
      <h1>Your safe is ready</h1>
      <KeyHolders ready={[true, true, true]} light />
      <ul className="rows">
        <li className="row">You hold one piece, on this phone, unlocked only with Face ID.</li>
        <li className="row">Swissquote holds one piece, to check your larger payments.</li>
        <li className="row">An independent safe-keeper holds one piece, to help you if you lose your phone.</li>
      </ul>
      <p className="small muted">
        Any two pieces together can move your money. Swissquote alone never can.
        {created?.passkey.protection === "device-key" &&
          " Prototype note: this browser cannot tie your piece to Face ID directly, so it is locked with this device's key store and Face ID confirms each use."}
      </p>
    </Screen>
  );
}
