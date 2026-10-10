"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LOOSENING_DELAY_SECONDS, RECOVERY_WAIT_SECONDS } from "@sqw/shared";
import { Mock, Screen } from "../../components/screen";
import { useWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { forgetThisPhone } from "../../lib/demo";
import { hasRecoveryKey } from "../../lib/recovery-key";

/** Demo panel (screen 9): the switches a presenter needs. Everything here is demo-only. */
export default function DemoPage() {
  const router = useRouter();
  const { profile, reload } = useWallet();
  const [offline, setOffline] = useState<boolean>();
  const [confirmLoss, setConfirmLoss] = useState(false);
  const [recoverable, setRecoverable] = useState<boolean>();

  useEffect(() => {
    cosigner
      .health()
      .then((h) => setOffline(h.offline))
      .catch(() => setOffline(true));
  }, []);

  useEffect(() => {
    if (profile) hasRecoveryKey(profile.walletId).then((r) => setRecoverable(r === true));
  }, [profile]);

  async function toggleOffline() {
    const next = !offline;
    await cosigner.setOffline(next);
    setOffline(next);
  }

  async function losePhone() {
    await forgetThisPhone();
    await reload();
    router.replace("/login");
  }

  return (
    <Screen back={{ href: "/" }}>
      <h1>
        Demo panel <Mock>Demo</Mock>
      </h1>

      <ul className="rows">
        <li className="row">
          <span className="row-main">
            <span className="row-title">Swissquote offline</span>
            <br />
            <span className="small muted">
              Stops Swissquote&rsquo;s co-signer. Pocket payments still work; larger moves use your recovery key and the
              independent safe-keeper.
            </span>
          </span>
          <button className="button secondary" style={{ width: "auto" }} onClick={toggleOffline} disabled={offline === undefined}>
            {offline ? "Bring back" : "Switch off"}
          </button>
        </li>
        <li className="row">
          <span className="row-main">
            <span className="row-title">Attacker mode</span>
            <br />
            <span className="small muted">A thief holds the unlocked phone and the client&rsquo;s email. Watch what fails.</span>
          </span>
          <Link href="/demo/attacker" className="button secondary" style={{ width: "auto" }}>
            Start
          </Link>
        </li>
        <li className="row">
          <span className="row-main">
            <span className="row-title">The client&rsquo;s other device</span>
            <br />
            <span className="small muted">Swissquote e-banking, where alerts arrive and changes can be cancelled.</span>
          </span>
          <a href="/e-banking" target="_blank" rel="noreferrer" className="button secondary" style={{ width: "auto" }}>
            Open
          </a>
        </li>
        <li className="row">
          <span className="row-main">
            <span className="row-title">Plan</span>
            <br />
            <span className="small muted">Premium or Standard: who pays the network fees.</span>
          </span>
          <Link href="/settings" className="button secondary" style={{ width: "auto" }}>
            Change
          </Link>
        </li>
      </ul>

      <section className="notice">
        <p className="row-title">Demo timers</p>
        <p className="small muted">
          New contacts and higher limits wait {LOOSENING_DELAY_SECONDS} seconds instead of 24 hours. A recovery waits{" "}
          {RECOVERY_WAIT_SECONDS} seconds instead of 48 hours.
        </p>
      </section>

      {profile && (
        <section className="notice warn">
          <p className="row-title">Lose this phone</p>
          <p className="small">
            Deletes this phone&rsquo;s piece of the key and its pocket key, as if the phone were lost. Then recover the safe
            with &ldquo;I lost my phone&rdquo;. You need your recovery key.
          </p>
          {recoverable === false ? (
            <p className="small" style={{ marginTop: 12 }}>
              This safe has no recovery key yet, so it could not be recovered. <Link href="/recovery-key">Add it first</Link>.
            </p>
          ) : confirmLoss ? (
            <button className="button" style={{ marginTop: 12 }} onClick={losePhone}>
              Yes, delete it from this phone
            </button>
          ) : (
            <button className="button secondary" style={{ marginTop: 12 }} onClick={() => setConfirmLoss(true)} disabled={!recoverable}>
              Lose this phone
            </button>
          )}
        </section>
      )}
    </Screen>
  );
}
