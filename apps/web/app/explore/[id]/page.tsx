"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { formatUnits, maxUint256, parseUnits } from "viem";
import {
  PROTOCOLS,
  USDC,
  aaveEthRate,
  chfForUsdc,
  formatEth,
  formatUsdc,
  minimumOut,
  quoteSwap,
  type AppRequest,
} from "@sqw/ethereum";
import { appById, type DefiApp, type EthSent, type PendingChange, type Rulebook } from "@sqw/shared";
import { AppConfirm, AppDone } from "../../../components/app-confirm";
import { Countdown, DemoModeNote } from "../../../components/countdown";
import { ShieldIcon } from "../../../components/icons";
import { Screen } from "../../../components/screen";
import { AppMark } from "../../../components/tokens";
import { RequireWallet } from "../../../components/wallet-context";
import { cosigner } from "../../../lib/cosigner";
import { formatChf } from "../../../lib/format";
import type { WalletProfile } from "../../../lib/profile";
import { loadRulebook, requestChange } from "../../../lib/rules";
import { usePrice } from "../../../lib/use-price";
import { appsAvailable, loadPositions, prepareAppUse, type AppUse } from "../../../lib/wallet-defi";
import { baseReader, loadUsdcBalance } from "../../../lib/wallet-usdc";

export default function AppPage() {
  return <RequireWallet>{(profile) => <AppScreen profile={profile} />}</RequireWallet>;
}

type Phase = { name: "panel" } | { name: "confirm"; use: AppUse } | { name: "done"; use: AppUse; sent: EthSent };

function AppScreen({ profile }: { profile: WalletProfile }) {
  const { id } = useParams<{ id: string }>();
  const app = appById(id);
  const [phase, setPhase] = useState<Phase>({ name: "panel" });

  if (!app) {
    return (
      <Screen back={{ href: "/explore", label: "Explore" }}>
        <h1>This app is not in Explore</h1>
      </Screen>
    );
  }
  if (phase.name === "confirm") {
    return <AppConfirm profile={profile} app={app} use={phase.use} onCancel={() => setPhase({ name: "panel" })} onSent={(sent) => setPhase({ name: "done", use: phase.use, sent })} />;
  }
  if (phase.name === "done") return <AppDone app={app} use={phase.use} sent={phase.sent} />;

  return (
    <Screen back={{ href: "/explore", label: "Explore" }}>
      <header className="app-head">
        <AppMark id={app.id} size={64} />
        <div>
          <h1>{app.name}</h1>
          <p className="muted">{app.tagline}</p>
        </div>
      </header>
      <p>{app.about}</p>
      {app.live ? (
        <>
          {app.id === "uniswap" ? <SwapPanel profile={profile} onReady={(use) => setPhase({ name: "confirm", use })} /> : <AavePanel profile={profile} onReady={(use) => setPhase({ name: "confirm", use })} />}
          <Approval profile={profile} app={app} />
        </>
      ) : (
        <p className="notice">
          {app.name} is not available in Swissquote Wallet yet. Swissquote adds an app once it has checked it and built a safe way to use it.
        </p>
      )}
    </Screen>
  );
}

/** Amount typed by the client, as token units; undefined while it is not a valid amount. */
function units(input: string, decimals: number): bigint | undefined {
  try {
    const value = parseUnits(input.replace(",", ".").trim(), decimals);
    return value > 0n ? value : undefined;
  } catch {
    return undefined;
  }
}

function useReady(profile: WalletProfile, onReady: (use: AppUse) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const prepare = async (request: AppRequest) => {
    setBusy(true);
    setError(undefined);
    try {
      onReady(await prepareAppUse(profile, request));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, prepare };
}

function SwapPanel({ profile, onReady }: { profile: WalletProfile; onReady: (use: AppUse) => void }) {
  const price = usePrice();
  const [fromUsdc, setFromUsdc] = useState(true);
  const [input, setInput] = useState("");
  const [quote, setQuote] = useState<bigint>();
  const [have, setHave] = useState<{ usdc: bigint; eth: bigint }>();
  const { busy, error, prepare } = useReady(profile, onReady);
  const tokenIn = fromUsdc ? USDC.address : PROTOCOLS.weth;
  const amountIn = units(input, fromUsdc ? 6 : 18);

  useEffect(() => {
    Promise.all([loadUsdcBalance(profile), loadPositions(profile)]).then(([usdc, positions]) => setHave({ usdc, eth: positions?.eth ?? 0n }));
  }, [profile]);

  useEffect(() => {
    setQuote(undefined);
    if (!amountIn) return;
    const timer = setTimeout(() => quoteSwap(baseReader, tokenIn, amountIn).then(setQuote, () => setQuote(undefined)), 350);
    return () => clearTimeout(timer);
  }, [amountIn, tokenIn]);

  const out = (value: bigint) => (fromUsdc ? formatEth(value) : formatUsdc(value));
  const chf = amountIn && price ? (fromUsdc ? chfForUsdc(amountIn, price.usdcChf) : (Number(amountIn) / 1e18) * price.ethChf) : undefined;

  return (
    <section className="card" aria-label="Exchange">
      <div className="segmented" role="group" aria-label="Direction">
        <button aria-pressed={fromUsdc} onClick={() => setFromUsdc(true)}>USDC → ETH</button>
        <button aria-pressed={!fromUsdc} onClick={() => setFromUsdc(false)}>ETH → USDC</button>
      </div>
      <label className="amount-entry">
        <span>{fromUsdc ? "USDC" : "ETH"}</span>
        <input inputMode="decimal" placeholder="0.00" value={input} onChange={(e) => setInput(e.target.value)} aria-label={`Amount of ${fromUsdc ? "USDC" : "ETH"} to exchange`} />
      </label>
      <p className="small muted">
        {chf !== undefined && <>About {formatChf(chf)} · </>}
        You have {have ? (fromUsdc ? formatUsdc(have.usdc) : formatEth(have.eth)) : "…"}
      </p>
      <p className="row-title">{quote !== undefined ? <>You get about {out(quote)}</> : amountIn ? "Asking Uniswap for a price…" : "\u00a0"}</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="button" disabled={!amountIn || quote === undefined || busy} onClick={() => amountIn && quote !== undefined && prepare({ app: "uniswap", tokenIn, amountIn, minOut: minimumOut(quote) })}>
        {busy ? "Preparing…" : "Continue"}
      </button>
    </section>
  );
}

function AavePanel({ profile, onReady }: { profile: WalletProfile; onReady: (use: AppUse) => void }) {
  const price = usePrice();
  const [deposit, setDeposit] = useState(true);
  const [input, setInput] = useState("");
  const [positions, setPositions] = useState<{ eth: bigint; ethInAave: bigint }>();
  const [rate, setRate] = useState<number>();
  const { busy, error, prepare } = useReady(profile, onReady);

  useEffect(() => {
    loadPositions(profile).then(setPositions);
    aaveEthRate(baseReader).then(setRate, () => undefined);
  }, [profile]);

  const amount = units(input, 18);
  const available = deposit ? positions?.eth : positions?.ethInAave;
  const everything = !deposit && amount !== undefined && available !== undefined && amount >= available;
  const chf = (wei: bigint | undefined) => (wei === undefined || !price ? "…" : formatChf((Number(wei) / 1e18) * price.ethChf));

  return (
    <section className="card" aria-label="Earn">
      <dl className="slip-details" style={{ padding: 0, border: 0 }}>
        <dt>Earning now</dt>
        <dd>{rate === undefined ? "…" : `${(rate * 100).toFixed(2)}% a year`}</dd>
        <dt>Your ETH in Aave</dt>
        <dd>{positions ? formatEth(positions.ethInAave) : "…"} · {chf(positions?.ethInAave)}</dd>
        <dt>ETH in your safe</dt>
        <dd>{positions ? formatEth(positions.eth) : "…"}</dd>
      </dl>
      <div className="segmented" role="group" aria-label="Deposit or withdraw">
        <button aria-pressed={deposit} onClick={() => setDeposit(true)}>Deposit</button>
        <button aria-pressed={!deposit} onClick={() => setDeposit(false)}>Withdraw</button>
      </div>
      <label className="amount-entry">
        <span>ETH</span>
        <input inputMode="decimal" placeholder="0.00" value={input} onChange={(e) => setInput(e.target.value)} aria-label={`Amount of ETH to ${deposit ? "deposit" : "withdraw"}`} />
      </label>
      {available !== undefined && available > 0n && (
        <button className="button quiet" onClick={() => setInput(formatUnits(available, 18))}>
          {deposit ? "Deposit all my ETH" : "Withdraw everything"}
        </button>
      )}
      {positions && positions.eth === 0n && deposit && (
        <p className="small muted">
          You have no ETH yet. <Link href="/explore/uniswap">Exchange some USDC for ETH on Uniswap</Link> first.
        </p>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button
        className="button"
        disabled={!amount || busy || (available !== undefined && amount > available)}
        onClick={() => amount && prepare({ app: "aave", action: deposit ? "supply" : "withdraw", amount: everything ? maxUint256 : amount })}
      >
        {busy ? "Preparing…" : "Continue"}
      </button>
    </section>
  );
}

/** "Use with Face ID alone": adding the app to the client's rules, after the waiting period. */
function Approval({ profile, app }: { profile: WalletProfile; app: DefiApp }) {
  const [rulebook, setRulebook] = useState<Rulebook>();
  const [pending, setPending] = useState<PendingChange>();
  const [supported, setSupported] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  const load = useCallback(async () => {
    setRulebook(await loadRulebook(profile.walletId));
    const changes = await cosigner.changes(profile.walletId).catch(() => []);
    setPending(changes.find((c) => c.status === "pending" && c.change.kind === "addApp" && c.change.appId === app.id));
    setSupported(await appsAvailable(profile).catch(() => false));
  }, [profile, app.id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!rulebook || supported === undefined) return null;
  if (!supported) return <p className="small muted">Your safe was opened before apps were available: each use is checked by Swissquote.</p>;
  if ((rulebook.apps ?? []).includes(app.id)) {
    return (
      <p className="protected">
        <ShieldIcon size={20} /> {app.name} works with Face ID alone, within a daily limit. You can remove it in Rules.
      </p>
    );
  }
  if (pending) {
    return (
      <p className="notice warn">
        {app.name} works with Face ID alone in <Countdown until={pending.effectiveAt} onDone={load} />. You can cancel it in Rules. <DemoModeNote production="24 hours" />
      </p>
    );
  }
  return (
    <section className="card">
      <p className="row-title">Use {app.name} with Face ID alone</p>
      <p className="small muted">
        Today, Swissquote checks each use. Approve it in your rules and Face ID will be enough, within a daily limit. As with a new
        contact, it takes effect after a waiting period, and you are alerted.
      </p>
      {message && <p className="notice" role="status">{message}</p>}
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await requestChange(profile, { kind: "addApp", appId: app.id });
            await load();
          } catch (err) {
            setMessage((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Waiting for Face ID…" : "Approve with Face ID"}
      </button>
    </section>
  );
}
