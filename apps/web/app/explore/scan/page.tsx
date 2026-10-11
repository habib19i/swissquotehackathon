"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionTypes } from "@walletconnect/types";
import { QrIcon } from "../../../components/icons";
import { Screen } from "../../../components/screen";
import { RequireWallet } from "../../../components/wallet-context";
import { connectedApps, disconnect, isPairingLink, pair, walletConnectAvailable } from "../../../lib/walletconnect";

export default function ScanPage() {
  return <RequireWallet>{() => <Scan />}</RequireWallet>;
}

/** The browser's QR code reader, where it exists (Chrome and Edge on Android, Chrome on desktop). */
interface QrReader {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
function qrReader(): QrReader | undefined {
  const Detector = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => QrReader }).BarcodeDetector;
  return Detector ? new Detector({ formats: ["qr_code"] }) : undefined;
}

/**
 * Connect an app with WalletConnect: scan the QR code it shows, or paste its link. Its requests then
 * appear as approval cards, checked by Swissquote.
 */
function Scan() {
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [link, setLink] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [apps, setApps] = useState<SessionTypes.Struct[]>([]);

  const refresh = useCallback(() => {
    connectedApps().then(setApps, () => undefined);
  }, []);

  useEffect(() => {
    if (!walletConnectAvailable()) return;
    refresh();
    const timer = setInterval(refresh, 4_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const connect = useCallback(
    async (uri: string) => {
      if (!isPairingLink(uri)) {
        setMessage({ ok: false, text: "This is not a WalletConnect code. In the app, choose WalletConnect to get one." });
        return;
      }
      setMessage({ ok: true, text: "Contacting the app… Its request to connect appears in a moment." });
      try {
        await pair(uri);
      } catch (err) {
        setMessage({ ok: false, text: `The app could not be reached: ${(err as Error).message}` });
      }
    },
    [],
  );

  // Camera: read QR codes until one is a WalletConnect link.
  useEffect(() => {
    if (!scanning) return;
    const reader = qrReader();
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (!video.current || !reader) return;
        video.current.srcObject = s;
        timer = setInterval(async () => {
          const [code] = await reader.detect(video.current!).catch(() => []);
          if (code?.rawValue) {
            setScanning(false);
            connect(code.rawValue);
          }
        }, 300);
      })
      .catch(() => {
        setScanning(false);
        setMessage({ ok: false, text: "The camera is not available. Paste the app's link instead." });
      });
    return () => {
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [scanning, connect]);

  if (!walletConnectAvailable()) {
    return (
      <Screen back={{ href: "/explore", label: "Explore" }}>
        <h1>Connect an app</h1>
        <p className="notice">WalletConnect is not set up in this prototype (NEXT_PUBLIC_REOWN_PROJECT_ID is missing in .env).</p>
      </Screen>
    );
  }

  const canScan = typeof window !== "undefined" && Boolean(qrReader());

  return (
    <Screen back={{ href: "/explore", label: "Explore" }}>
      <h1>Connect an app</h1>
      <p className="lead">
        On the app&rsquo;s website, choose <strong>WalletConnect</strong>. Scan the QR code it shows, or copy its link and paste it here.
      </p>
      <p className="small muted">
        Works today with app.aave.com in testnet mode, on Base Sepolia. Every request it sends is checked by Swissquote and needs your
        Face ID.
      </p>

      {scanning ? (
        <div className="scanner">
          <video ref={video} autoPlay playsInline muted />
          <button className="button secondary" onClick={() => setScanning(false)}>Stop</button>
        </div>
      ) : (
        canScan && (
          <button className="button" onClick={() => setScanning(true)}>
            <QrIcon /> Scan the QR code
          </button>
        )
      )}

      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          connect(link);
        }}
      >
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the app's link (wc:…)" aria-label="WalletConnect link" />
        <button type="submit" className="ask-send" aria-label="Connect" disabled={!link.trim()}>
          <QrIcon size={22} />
        </button>
      </form>
      {message && <p className={`notice ${message.ok ? "ok" : "error"}`} role="status">{message.text}</p>}

      <h2>Connected apps</h2>
      <ul className="rows">
        {apps.length === 0 && <li className="row small muted">None yet.</li>}
        {apps.map((s) => (
          <li key={s.topic} className="row">
            {s.peer.metadata.icons?.[0] && <img src={s.peer.metadata.icons[0]} alt="" width={36} height={36} className="peer-icon" />}
            <span className="row-main">
              <span className="row-title">{s.peer.metadata.name}</span>
              <br />
              <span className="small muted">{s.peer.metadata.url.replace(/^https?:\/\//, "")}</span>
            </span>
            <button className="button quiet" style={{ width: "auto" }} onClick={() => disconnect(s.topic).then(refresh)}>
              Disconnect
            </button>
          </li>
        ))}
      </ul>
    </Screen>
  );
}
