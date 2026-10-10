"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DEMO_CLIENT } from "@sqw/shared";
import { Mock, Screen } from "../../components/screen";
import { useWallet } from "../../components/wallet-context";
import { saveClient } from "../../lib/profile";

/** MOCK Swissquote login: the client already has an account and has passed KYC. */
export default function LoginPage() {
  const router = useRouter();
  const { profile, reload } = useWallet();
  const [clientNumber, setClientNumber] = useState(DEMO_CLIENT.clientNumber);

  async function logIn(event: React.FormEvent) {
    event.preventDefault();
    await saveClient({ name: DEMO_CLIENT.name, clientNumber: clientNumber.trim() || DEMO_CLIENT.clientNumber });
    await reload();
    router.push(profile ? "/" : "/onboarding");
  }

  return (
    <form onSubmit={logIn} style={{ display: "contents" }}>
      <Screen actions={<button className="button">Log in</button>}>
        <h1>Log in to your Swissquote account</h1>
        <p className="lead">Your identity is already verified with Swissquote, so there is nothing else to fill in.</p>
        <div className="field">
          <label htmlFor="client-number">Client number</label>
          <input
            id="client-number"
            className="input tabular"
            value={clientNumber}
            onChange={(e) => setClientNumber(e.target.value)}
            autoComplete="username"
          />
        </div>
        <p className="small muted">
          <Mock /> The Swissquote login and identity check are simulated in this prototype.
        </p>
      </Screen>
    </form>
  );
}
