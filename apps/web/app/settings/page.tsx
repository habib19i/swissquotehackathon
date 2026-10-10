"use client";

import { useEffect, useState } from "react";
import type { Plan } from "@sqw/shared";
import { PlanChoice } from "../../components/plan-choice";
import { Mock, Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { cosigner } from "../../lib/cosigner";
import { formatSatsAsChf } from "../../lib/format";
import type { WalletProfile } from "../../lib/profile";
import { usePrice } from "../../lib/use-price";

export default function SettingsPage() {
  return <RequireWallet>{(profile) => <Settings profile={profile} />}</RequireWallet>;
}

type DemoAccount = Awaited<ReturnType<typeof cosigner.demoAccount>>;

/** Plan (CLAUDE.md section 7) and, for the demo, Swissquote's operational wallet. */
function Settings({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [plan, setPlan] = useState<Plan>();
  const [account, setAccount] = useState<DemoAccount>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    cosigner
      .wallet(profile.walletId)
      .then((r) => setPlan(r.plan))
      .catch((err) => setMessage((err as Error).message));
    cosigner.demoAccount().then(setAccount).catch(() => undefined);
  }, [profile]);

  async function collect() {
    try {
      const { txids } = await cosigner.demoCollect();
      setMessage(txids.length ? `Collected test bitcoin from ${txids.length} family wallet(s).` : "The demo family has no confirmed test bitcoin to collect yet.");
      setAccount(await cosigner.demoAccount());
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function choose(next: Plan) {
    setPlan(next);
    try {
      await cosigner.setPlan(profile.walletId, next);
      setMessage(next === "premium" ? "Premium: Swissquote now pays your network fees." : "Standard: you now pay the network fee of each payment.");
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  return (
    <Screen back={{ href: "/" }}>
      <h1>Your plan</h1>
      {plan && <PlanChoice value={plan} onChange={choose} />}
      {message && <p className="notice" role="status">{message}</p>}

      {account && (
        <section className="notice">
          <p className="row-title">
            Swissquote demo account <Mock />
          </p>
          <p className="small muted">
            Pays network fees on the Premium plan (up to {formatSatsAsChf(BigInt(account.dailyFeeCapSats), price?.btcChf)} per
            client per day) and plays your Swissquote account for transfers. It collects what the demo family receives,
            so test bitcoin keeps circulating.
          </p>
          <p className="tabular">
            Ready: {formatSatsAsChf(BigInt(account.ready), price?.btcChf)}
            {account.waiting > 0 && <>, waiting for the network: {formatSatsAsChf(BigInt(account.waiting), price?.btcChf)}</>}
          </p>
          <p className="address tabular">{account.address}</p>
          <p className="small muted">Fund it with test bitcoin from a faucet, ideally well before a demo.</p>
          <button className="button secondary" style={{ marginTop: 12 }} onClick={collect}>
            Collect the demo family&rsquo;s test bitcoin now
          </button>
        </section>
      )}
    </Screen>
  );
}
