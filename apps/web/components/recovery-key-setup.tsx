"use client";

import { useState } from "react";
import type { RecoveryKeyKind } from "@sqw/shared";
import type { WalletProfile } from "../lib/profile";
import { addRecoveryKey } from "../lib/recovery-key";

const KINDS: { id: RecoveryKeyKind; name: string; description: string }[] = [
  {
    id: "security-key",
    name: "Security key from Swissquote",
    description: "A small key Swissquote sends you by post. Keep it at home, away from your phone. Recommended.",
  },
  {
    id: "synced",
    name: "Passkey in your Apple or Google account",
    description: "More convenient, but whoever controls that account could use it too.",
  },
];

/**
 * Registers the RECOVERY key with the independent recovery provider (CLAUDE.md section 5).
 * It is only used if this phone is lost, never for payments.
 */
export function RecoveryKeySetup({ profile, onDone }: { profile: WalletProfile; onDone: () => void }) {
  const [kind, setKind] = useState<RecoveryKeyKind>("security-key");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function register() {
    setBusy(true);
    setError(undefined);
    try {
      await addRecoveryKey(profile, kind);
      onDone();
    } catch (err) {
      setError(`Your recovery key was not added: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Add your recovery key</h1>
      <p className="lead">
        If you lose this phone, your recovery key and a face check bring your safe back on a new phone. You will not
        need it for payments.
      </p>
      <div role="radiogroup" aria-label="Recovery key" className="plans">
        {KINDS.map((k) => (
          <button key={k.id} role="radio" aria-checked={kind === k.id} className="plan" onClick={() => setKind(k.id)}>
            <span className="row-title">{k.name}</span>
            <span className="small muted">{k.description}</span>
          </button>
        ))}
      </div>
      {kind === "synced" && (
        <p className="notice warn">
          A synced passkey is only as safe as your Apple or Google account. If someone takes over that account, they get
          one of the two things needed to move your safe.
        </p>
      )}
      {error && <p className="notice error" role="alert">{error}</p>}
      <button className="button" onClick={register} disabled={busy}>
        {busy ? "Waiting for your key…" : kind === "security-key" ? "Use my security key" : "Create the passkey"}
      </button>
    </>
  );
}
