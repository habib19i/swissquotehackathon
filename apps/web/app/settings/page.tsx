"use client";

import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { formatUsdc } from "@sqw/ethereum";
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
      const { txids, usdcTxs } = await cosigner.demoCollect();
      const collected = [txids.length && `test bitcoin from ${txids.length}`, usdcTxs.length && `test USDC from ${usdcTxs.length}`].filter(Boolean);
      setMessage(collected.length ? `Collected ${collected.join(" and ")} family wallet(s).` : "The demo family has nothing confirmed to collect yet.");
      setAccount(await cosigner.demoAccount());
    } catch (err) {
      setMessage((err as Error).message);
    }
  }

  async function choose(next: Plan) {
    setPlan(next);
    try {
      await cosigner.setPlan(profile.walletId, next);
      setMessage(
        next === "premium"
          ? "Premium: Swissquote now pays your network fees, in bitcoin and in digital dollars."
          : "Standard: you now pay the network fee of each payment (in digital dollars: a small USDC fee to Swissquote, never ETH).",
      );
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
            Collect the demo family&rsquo;s test coins now
          </button>
        </section>
      )}

      {account?.base && (
        <section className="notice">
          <p className="row-title">
            Swissquote on Base <Mock />
          </p>
          <p className="small muted">
            Relays digital dollar payments to the network (bundler), pays their gas from its deposit (paymaster), and
            plays your Swissquote account for USDC transfers.
          </p>
          <dl className="slip-details" style={{ padding: 0, border: 0 }}>
            <dt>Test USDC</dt>
            <dd className="tabular">{formatUsdc(BigInt(account.base.usdc))}</dd>
            <dt>Gas deposit</dt>
            <dd className="tabular">{formatEther(BigInt(account.base.paymasterDeposit))} ETH</dd>
            <dt>Relay wallet</dt>
            <dd className="tabular">{formatEther(BigInt(account.base.eth))} ETH</dd>
          </dl>
          <p className="address tabular">{account.base.address}</p>
          <p className="small muted">
            Get test USDC for this address at faucet.circle.com (network: Base Sepolia).
          </p>
        </section>
      )}
    </Screen>
  );
}
