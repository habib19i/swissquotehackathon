"use client";

import { useEffect, useState } from "react";
import type { WalletKitTypes } from "@reown/walletkit";
import { explorer, type EthPrepared } from "@sqw/shared";
import { formatChf, shortId } from "../lib/format";
import {
  approveConnection,
  offersBaseSepolia,
  prepareDappTransaction,
  rejectConnection,
  respond,
  sendDappTransaction,
  transactionOf,
  walletConnectAvailable,
  walletKit,
} from "../lib/walletconnect";
import { FaceIcon, ShieldIcon } from "./icons";
import { useWallet } from "./wallet-context";

type Pending =
  | { kind: "connect"; proposal: WalletKitTypes.SessionProposal }
  | { kind: "request"; request: WalletKitTypes.SessionRequest; app: { name: string; url: string } };

/**
 * Approval cards for connected apps (after Orchestra's approval overlay): a connection request or an app's
 * transaction appears over whatever screen is open, with Swissquote's check, and waits for the client.
 */
export function ConnectOverlay() {
  const { profile } = useWallet();
  const [queue, setQueue] = useState<Pending[]>([]);

  useEffect(() => {
    if (!profile || !walletConnectAvailable()) return;
    let alive = true;
    const onProposal = (proposal: WalletKitTypes.SessionProposal) => alive && setQueue((q) => [...q, { kind: "connect", proposal }]);
    const onRequest = (request: WalletKitTypes.SessionRequest) =>
      walletKit().then((kit) => {
        const peer = kit.getActiveSessions()[request.topic]?.peer.metadata;
        if (alive) setQueue((q) => [...q, { kind: "request", request, app: { name: peer?.name ?? "An app", url: peer?.url ?? "" } }]);
      });
    walletKit()
      .then((kit) => {
        kit.on("session_proposal", onProposal);
        kit.on("session_request", onRequest);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      walletKit()
        .then((kit) => {
          kit.off("session_proposal", onProposal);
          kit.off("session_request", onRequest);
        })
        .catch(() => undefined);
    };
  }, [profile]);

  const current = queue[0];
  if (!current || !profile) return null;
  const next = () => setQueue((q) => q.slice(1));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={current.kind === "connect" ? "An app wants to connect" : "An app asks for a transaction"}>
      <div className="sheet">
        {current.kind === "connect" ? (
          <ConnectCard proposal={current.proposal} onDone={next} />
        ) : (
          <RequestCard request={current.request} app={current.app} onDone={next} />
        )}
      </div>
    </div>
  );
}

function AppIdentity({ name, url, icon, verified }: { name: string; url: string; icon?: string; verified?: string }) {
  return (
    <div className="app-head">
      {icon ? <img src={icon} alt="" width={48} height={48} className="peer-icon" /> : null}
      <div>
        <p className="row-title">{name}</p>
        <p className="small muted">{url.replace(/^https?:\/\//, "")}</p>
        {verified === "VALID" && <p className="small" style={{ color: "var(--protect)" }}>Website verified by WalletConnect</p>}
        {verified === "INVALID" && <p className="small" style={{ color: "var(--danger)" }}>This website does not match the app it claims to be</p>}
      </div>
    </div>
  );
}

function ConnectCard({ proposal, onDone }: { proposal: WalletKitTypes.SessionProposal; onDone: () => void }) {
  const { profile } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const peer = proposal.params.proposer.metadata;
  const scam = proposal.verifyContext?.verified.isScam;
  const usable = offersBaseSepolia(proposal);

  async function act(approve: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      if (approve && profile) await approveConnection(profile, proposal);
      else await rejectConnection(proposal);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <h2>Connect this app?</h2>
      <AppIdentity name={peer.name} url={peer.url} icon={peer.icons?.[0]} verified={proposal.verifyContext?.verified.validation} />
      {scam ? (
        <p className="notice error">WalletConnect reports this website as a scam. Do not connect it.</p>
      ) : !usable ? (
        <p className="notice warn">
          {peer.name} does not offer Base Sepolia, the test network this wallet uses, so it cannot connect. To exchange USDC and ETH,
          use Uniswap from Explore in this app.
        </p>
      ) : (
        <p className="small muted">
          The app will see your USDC account on Base. It can only ask: every transaction it asks for is checked by Swissquote and needs
          your Face ID.
        </p>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      {usable && !scam && (
        <button className="button" disabled={busy} onClick={() => act(true)}>
          {busy ? "Connecting…" : "Connect"}
        </button>
      )}
      <button className="button secondary" disabled={busy} onClick={() => act(false)}>
        {usable && !scam ? <>Don&rsquo;t connect</> : "Close"}
      </button>
    </>
  );
}

function RequestCard({ request, app, onDone }: { request: WalletKitTypes.SessionRequest; app: { name: string; url: string }; onDone: () => void }) {
  const { profile } = useWallet();
  const [prepared, setPrepared] = useState<EthPrepared>();
  const [refusal, setRefusal] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string>();

  useEffect(() => {
    if (!profile) return;
    (async () => transactionOf(request))()
      .then((tx) => prepareDappTransaction(profile, tx))
      .then(setPrepared)
      .catch((err: Error) => setRefusal(err.message));
  }, [profile, request]);

  const review = prepared?.review;

  async function reject(reason: string) {
    await respond(request, { error: reason }).catch(() => undefined);
    onDone();
  }

  async function confirm() {
    if (!profile || !prepared) return;
    setBusy(true);
    try {
      const result = await sendDappTransaction(profile, prepared);
      await respond(request, { hash: result.txHash });
      setSent(result.txHash);
    } catch (err) {
      setRefusal((err as Error).message);
      await respond(request, { error: (err as Error).message }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <>
        <h2>Done</h2>
        <p className="notice ok">
          {app.name} has its answer: the transaction is confirmed on Base.
          <br />
          <a className="small" href={explorer.baseTx(sent)} target="_blank" rel="noreferrer">View {shortId(sent)} on Base</a>
        </p>
        <button className="button" onClick={onDone}>Close</button>
      </>
    );
  }

  return (
    <>
      <h2>{app.name} asks you to confirm</h2>
      <AppIdentity name={app.name} url={app.url} verified={request.verifyContext?.verified.validation} />
      {!prepared && !refusal && <p className="muted">Swissquote is checking the request…</p>}
      {refusal && <p className="notice error" role="alert">{refusal}</p>}
      {review && (
        <div className={`notice ${review.verdict === "BLOCKED" ? "error" : "warn"}`} role="status">
          <p className="protected" style={{ color: "inherit" }}>
            <ShieldIcon size={20} /> {review.verdict === "BLOCKED" ? "Stopped by Swissquote" : "Checked by Swissquote"}
          </p>
          {review.reasons.map((r) => (
            <p key={r}>{r}</p>
          ))}
          {review.valueChf > 0 && <p className="small">About {formatChf(review.valueChf)}</p>}
        </div>
      )}
      {prepared && review?.verdict !== "BLOCKED" && !refusal && (
        <>
          <p className="small muted">Network fee: paid by Swissquote.</p>
          {!confirmed ? (
            <button className="button" onClick={() => setConfirmed(true)}>Yes, I want to do this</button>
          ) : (
            <button className="button" disabled={busy} onClick={confirm}>
              <FaceIcon /> {busy ? "Sending…" : "Confirm with Face ID"}
            </button>
          )}
        </>
      )}
      <button className="button secondary" disabled={busy} onClick={() => reject(refusal ?? "The client declined.")}>
        {refusal ? "Close" : "Decline"}
      </button>
    </>
  );
}
