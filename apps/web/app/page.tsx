"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { chfToSats, refillAmount, satsToChf } from "@sqw/bitcoin";
import { chfForUsdc, formatEth, formatUsdc } from "@sqw/ethereum";
import { DEFAULT_POCKET_SIZE_CHF, explorer, type Alert, type EthStatus, type WalletRecord } from "@sqw/shared";
import {
  BellIcon,
  CheckIcon,
  ClockIcon,
  EyeIcon,
  EyeOffIcon,
  GearIcon,
  ReceiveIcon,
  RulesIcon,
  SendIcon,
  ShieldIcon,
  VaultIcon,
} from "../components/icons";
import { AskBox } from "../components/ask-box";
import { KeyHolders } from "../components/keyholders";
import { BtcToken, EthToken, UsdcToken } from "../components/tokens";
import { Mock, Screen } from "../components/screen";
import { RequireWallet } from "../components/wallet-context";
import { cosigner, swissquoteOnline } from "../lib/cosigner";
import { formatBtc, formatChf, formatSatsAsChf, shortId } from "../lib/format";
import { hasRecoveryKey } from "../lib/recovery-key";
import type { WalletProfile } from "../lib/profile";
import { proveUsdcOwnership } from "../lib/ownership";
import { finishSetup, swissquoteRecord } from "../lib/setup";
import { usePrice } from "../lib/use-price";
import { loadBalances, moveExcessToSavings, refillPocketNow, withShare, type Balances } from "../lib/wallet-bitcoin";
import { loadUsdcBalance, updateRulesOnBase } from "../lib/wallet-usdc";
import { loadPositions } from "../lib/wallet-defi";

export default function HomePage() {
  return <RequireWallet>{(profile) => <Home profile={profile} />}</RequireWallet>;
}

/** The outcome of a Face ID action, with its transaction on either network. */
type Done = { text: string; txid?: string; baseTx?: string };

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** Above this share of its size, the extra in the pocket is offered back to the Savings safe. */
const POCKET_EXCESS_MARGIN = 1.2;

function Home({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const [balances, setBalances] = useState<Balances>();
  const [record, setRecord] = useState<WalletRecord | null>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done>();
  /** USDC units; null when USDC are not available on this phone. */
  const [usdc, setUsdc] = useState<bigint | null>();
  const [onBase, setOnBase] = useState<EthStatus>();
  /** ETH from Uniswap, and ETH earning in Aave (accounts with apps). */
  const [positions, setPositions] = useState<{ eth: bigint; ethInAave: bigint }>();
  const [online, setOnline] = useState(true);
  const [recoveryKey, setRecoveryKey] = useState<boolean>();
  const [urgent, setUrgent] = useState<Alert>();
  /** Amounts hidden from people looking over the client's shoulder. */
  const [hidden, setHidden] = useState(false);

  const load = useCallback(() => {
    loadBalances(profile)
      .then((b) => {
        setBalances(b);
        setError(undefined);
      })
      .catch(() => setError("Balances could not be loaded from the Bitcoin network. Retrying…"));
    swissquoteRecord(profile.walletId)
      .then((r) => setRecord(r ?? null))
      .catch(() => setRecord(undefined));
    loadUsdcBalance(profile)
      .then((units) => {
        setUsdc(units);
        return cosigner.ethStatus(profile.walletId).then(setOnBase);
      })
      .catch(() => setUsdc((current) => current ?? null));
    loadPositions(profile)
      .then(setPositions)
      .catch(() => undefined);
    swissquoteOnline().then(setOnline);
    hasRecoveryKey(profile.walletId).then(setRecoveryKey);
    // The latest alert the client may need to act on: a change on hold, or a recovery under way.
    cosigner
      .alerts(profile.walletId)
      .then((alerts) => {
        // Alerts are newest first: a request is still open if nothing newer concerns the same change or recovery.
        const open = alerts.find(
          (a, i) =>
            (a.type === "rulebook-change-requested" || a.type === "recovery-started") &&
            !alerts.slice(0, i).some((b) => (a.changeId && b.changeId === a.changeId) || (a.recoveryId && b.recoveryId === a.recoveryId)),
        );
        setUrgent(open);
      })
      .catch(() => setUrgent(undefined));
  }, [profile]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 20_000);
    return () => clearInterval(timer);
  }, [load]);

  /** Runs one Face ID action and reports its outcome in plain language. */
  async function act(action: () => Promise<Done | undefined>) {
    setBusy(true);
    setDone(undefined);
    setError(undefined);
    try {
      setDone(await action());
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const pocket = balances ? balances.pocket.confirmed + balances.pocket.pending : undefined;
  const savings = balances ? balances.savings.confirmed + balances.savings.pending : undefined;
  const pending = balances ? balances.pocket.pending + balances.savings.pending : 0n;
  const total = pocket !== undefined && savings !== undefined ? pocket + savings : undefined;
  const usdcChf = usdc && price ? chfForUsdc(usdc, price.usdcChf) : 0;
  const ethWei = (positions?.eth ?? 0n) + (positions?.ethInAave ?? 0n);
  const ethChf = (wei: bigint) => (price ? (Number(wei) / 1e18) * price.ethChf : 0);
  const totalChf = total !== undefined && price ? satsToChf(total, price.btcChf) + usdcChf + ethChf(ethWei) : undefined;
  const baseBehind = onBase && (!onBase.rulesUpToDate || !onBase.passkeyUpToDate);
  const pocketSize = price ? chfToSats(DEFAULT_POCKET_SIZE_CHF, price.btcChf) : undefined;
  const excess =
    pocket !== undefined && pocketSize && pocket > (pocketSize * BigInt(POCKET_EXCESS_MARGIN * 10)) / 10n
      ? pocket - pocketSize
      : 0n;
  const refill = pocket !== undefined && pocketSize && savings ? refillAmount(pocket, pocketSize) : 0n;
  const firstName = profile.client.name.split(" ")[0];
  const initials = profile.client.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);

  const hide = (text: string) => (hidden ? "••••" : text);

  return (
    <Screen tabs>
      <header className="home-head rise" style={{ "--i": 0 } as React.CSSProperties}>
        <span className="avatar" aria-hidden="true">
          {initials}
        </span>
        <div className="row-main">
          <p className="small muted">{greeting()}</p>
          <p className="row-title">{firstName}</p>
        </div>
        <Link href="/alerts" className="round-button" aria-label={urgent ? "Alerts: one needs your attention" : "Alerts"}>
          <BellIcon />
          {urgent && <span className="dot" aria-hidden="true" />}
        </Link>
        <Link href="/settings" className="round-button" aria-label="Plan and settings">
          <GearIcon />
        </Link>
      </header>

      <section className="balance rise" style={{ "--i": 1 } as React.CSSProperties} aria-label="Your safe">
        <p className="muted">Total value</p>
        <button className="balance-amount" onClick={() => setHidden((h) => !h)} aria-pressed={hidden} aria-label={hidden ? "Show amounts" : "Hide amounts"}>
          <span className="tabular">{totalChf === undefined ? "…" : hide(formatChf(totalChf))}</span>
          {hidden ? <EyeOffIcon size={22} /> : <EyeIcon size={22} />}
        </button>
        {total !== undefined && !hidden && (
          <p className="small muted tabular">
            {formatBtc(total)}
            {usdc ? ` · ${formatUsdc(usdc)}` : ""}
          </p>
        )}
        <p className="chip">
          <ShieldIcon size={18} /> Protected by Swissquote
          {record?.ownershipVerifiedAt && (
            <>
              {" · "}
              <CheckIcon size={16} /> Verified yours
            </>
          )}
        </p>
      </section>

      <nav className="quick-actions rise" style={{ "--i": 3 } as React.CSSProperties} aria-label="Quick actions">
        <Link href="/receive" className="quick-action">
          <span className="quick-icon"><ReceiveIcon /></span>
          Receive
        </Link>
        <Link href="/send" className="quick-action">
          <span className="quick-icon"><SendIcon /></span>
          Send
        </Link>
        <Link href="/activity" className="quick-action">
          <span className="quick-icon"><ClockIcon /></span>
          Activity
        </Link>
        <Link href="/rules" className="quick-action">
          <span className="quick-icon"><RulesIcon /></span>
          Rules
        </Link>
      </nav>

      {!online && (
        <p className="notice warn" role="status">
          Swissquote is offline. Your Spending pocket works as usual. Larger payments from your Savings safe use your
          recovery key and the independent safe-keeper instead. USDC payments wait until Swissquote is back:
          in this prototype, Swissquote relays them to the network.
        </p>
      )}
      {urgent && (
        <Link href="/alerts" className="notice warn" style={{ display: "block", textDecoration: "none" }}>
          <span className="row-title">Swissquote alert</span>
          <br />
          {urgent.message}
        </Link>
      )}
      {recoveryKey === false && record?.ownershipVerifiedAt && (
        <Link href="/recovery-key" className="notice warn" style={{ display: "block", textDecoration: "none" }}>
          <span className="row-title">Add your recovery key</span>
          <br />
          Without it, nobody can bring your safe back if you lose this phone.
        </Link>
      )}
      {record === null && (
        <div className="notice warn">
          <p>Swissquote has not verified this safe yet. Finish setting it up to use your Savings safe.</p>
          <button
            className="button"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() =>
              act(async () => {
                await withShare(profile, (share) => finishSetup(profile, share));
                return { text: "Swissquote has verified that this safe is yours." };
              })
            }
          >
            Finish setting up with Face ID
          </button>
        </div>
      )}
      {baseBehind && online && (
        <div className="notice warn">
          <p className="row-title">Your USDC account needs your new rules</p>
          <p>Your account on Base still follows your previous rules or Face ID. Confirm to bring it up to date.</p>
          <button
            className="button"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() =>
              act(async () => {
                const sent = await updateRulesOnBase(profile);
                return { text: "Your USDC account now follows your rules.", baseTx: sent?.txHash };
              })
            }
          >
            Update with Face ID
          </button>
        </div>
      )}
      {record?.ownershipVerifiedAt && record.ethereum && !record.ethereum.ownershipVerifiedAt && online && (
        <div className="notice">
          <p>Swissquote has not verified your USDC account yet. It takes one Face ID.</p>
          <button
            className="button secondary"
            style={{ marginTop: 12 }}
            disabled={busy}
            onClick={() =>
              act(async () => {
                await withShare(profile, (share) => proveUsdcOwnership(profile, share));
                return { text: "Swissquote has verified that your USDC account is yours." };
              })
            }
          >
            Verify with Face ID
          </button>
        </div>
      )}

      {error && <p className="notice error" role="alert">{error}</p>}
      {done && (
        <p className="notice ok" role="status">
          {done.text}
          {done.txid && (
            <>
              <br />
              <a className="small" href={explorer.btcTx(done.txid)} target="_blank" rel="noreferrer">
                View {shortId(done.txid)} on the Bitcoin network
              </a>
            </>
          )}
          {done.baseTx && (
            <>
              <br />
              <a className="small" href={explorer.baseTx(done.baseTx)} target="_blank" rel="noreferrer">
                View {shortId(done.baseTx)} on Base
              </a>
            </>
          )}
        </p>
      )}
      {pending > 0n && (
        <p className="notice">
          {formatSatsAsChf(pending, price?.btcChf)} is on its way. Bitcoin payments usually arrive within 10 minutes.
        </p>
      )}


      <h2 className="section-title">Your pockets</h2>
      <ul className="assets" aria-label="Your pockets">
        <li className="rise" style={{ "--i": 4 } as React.CSSProperties}>
          <Link href="/send" className="asset">
            <span className="coin" aria-hidden="true"><BtcToken /></span>
            <span className="row-main">
              <span className="row-title">Spending pocket</span>
              <br />
              <span className="small muted">Bitcoin · Face ID only</span>
            </span>
            <span className="asset-amount">
              <span className="row-title tabular">{pocket === undefined ? "…" : hide(formatSatsAsChf(pocket, price?.btcChf))}</span>
              <br />
              <span className="small muted tabular">{pocket === undefined || hidden ? "" : formatBtc(pocket)}</span>
            </span>
          </Link>
        </li>
        <li className="rise" style={{ "--i": 5 } as React.CSSProperties}>
          <Link href="/send" className="asset">
            <span className="coin" aria-hidden="true">
              <BtcToken />
              <span className="coin-badge"><VaultIcon size={12} /></span>
            </span>
            <span className="row-main">
              <span className="row-title">Savings safe</span>
              <br />
              <span className="small muted">Bitcoin · checked by Swissquote</span>
            </span>
            <span className="asset-amount">
              <span className="row-title tabular">{savings === undefined ? "…" : hide(formatSatsAsChf(savings, price?.btcChf))}</span>
              <br />
              <span className="small muted tabular">{savings === undefined || hidden ? "" : formatBtc(savings)}</span>
            </span>
          </Link>
        </li>
        <li className="rise" style={{ "--i": 6 } as React.CSSProperties}>
          <Link href="/send" className="asset">
            <span className="coin" aria-hidden="true"><UsdcToken /></span>
            <span className="row-main">
              <span className="row-title">USDC</span>
              <br />
              <span className="small muted">{usdc === null ? "Not available on this phone" : "On Base · Face ID within your limit"}</span>
            </span>
            <span className="asset-amount">
              <span className="row-title tabular">{usdc === undefined ? "…" : usdc === null ? "–" : hide(formatChf(usdcChf))}</span>
              <br />
              <span className="small muted tabular">{usdc && !hidden ? formatUsdc(usdc) : ""}</span>
            </span>
          </Link>
        </li>
        {positions && positions.eth > 0n && (
          <li className="rise" style={{ "--i": 7 } as React.CSSProperties}>
            <Link href="/explore/uniswap" className="asset">
              <span className="coin" aria-hidden="true"><EthToken /></span>
              <span className="row-main">
                <span className="row-title">ETH</span>
                <br />
                <span className="small muted">On Base · from Uniswap</span>
              </span>
              <span className="asset-amount">
                <span className="row-title tabular">{hide(formatChf(ethChf(positions.eth)))}</span>
                <br />
                <span className="small muted tabular">{hidden ? "" : formatEth(positions.eth)}</span>
              </span>
            </Link>
          </li>
        )}
        {positions && positions.ethInAave > 0n && (
          <li className="rise" style={{ "--i": 8 } as React.CSSProperties}>
            <Link href="/explore/aave" className="asset">
              <span className="coin" aria-hidden="true">
                <EthToken />
                <span className="coin-badge app-badge">A</span>
              </span>
              <span className="row-main">
                <span className="row-title">ETH earning in Aave</span>
                <br />
                <span className="small muted">Interest added every second</span>
              </span>
              <span className="asset-amount">
                <span className="row-title tabular">{hide(formatChf(ethChf(positions.ethInAave)))}</span>
                <br />
                <span className="small muted tabular">{hidden ? "" : formatEth(positions.ethInAave)}</span>
              </span>
            </Link>
          </li>
        )}
      </ul>

      <div className="rise" style={{ "--i": 7 } as React.CSSProperties}>
        <AskBox />
      </div>

      {excess > 0n && price && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const txid = await moveExcessToSavings(profile, excess);
              return { text: `${formatSatsAsChf(excess, price.btcChf)} is moving to your Savings safe.`, txid };
            })
          }
        >
          Move {formatSatsAsChf(excess, price.btcChf)} to my Savings safe
        </button>
      )}
      {refill > 0n && price && record?.ownershipVerifiedAt && (
        <button
          className="button secondary"
          disabled={busy}
          onClick={() =>
            act(async () => {
              const outcome = await refillPocketNow(profile, price.btcChf);
              if (outcome && "error" in outcome) throw new Error(outcome.error);
              return outcome && { text: `${formatSatsAsChf(outcome.amount, price.btcChf)} is moving to your Spending pocket.`, txid: outcome.txid };
            })
          }
        >
          Refill my Spending pocket
        </button>
      )}


      <section className="card rise" style={{ "--i": 8 } as React.CSSProperties} aria-label="Who holds your key">
        <p className="row-title">One key, three pieces</p>
        <p className="small muted">Any two can sign. Swissquote alone never can.</p>
        <KeyHolders ready={[true, true, true]} light />
      </section>

      <Link href="/demo" className="button quiet">
        Demo panel
      </Link>
      <p className="small muted">
        Test bitcoin on the Bitcoin test network and test USDC on Base Sepolia, shown at the{" "}
        {price?.mock ? "fixed demo" : "live"} price for illustration{price?.mock && <> <Mock /></>}.
      </p>
    </Screen>
  );
}
