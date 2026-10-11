"use client";

import { useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { ShieldIcon } from "../../../components/icons";
import { Screen } from "../../../components/screen";

/**
 * The recovery key for the iOS app (docs/ios-plan.md). The app opens this page in an
 * ASWebAuthenticationSession with `#mode=register|authenticate&options=…&state=…`: the recovery provider's
 * WebAuthn options, base64url JSON. The client uses their recovery key here (the provider checks this
 * website's origin), and the page hands the result back to the app at `sqwallet://recovery-key#…`.
 */
type Mode = "register" | "authenticate";

interface Request {
  mode: Mode;
  options: unknown;
  state: string;
}

const CALLBACK = "sqwallet://recovery-key";

const toBase64url = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromBase64url = (text: string) =>
  new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

function readRequest(): Request | undefined {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const mode = params.get("mode");
  const options = params.get("options");
  const state = params.get("state");
  if ((mode !== "register" && mode !== "authenticate") || !options || !state) return undefined;
  try {
    return { mode, options: JSON.parse(fromBase64url(options)), state };
  } catch {
    return undefined;
  }
}

/** Back to the app, with the result or the reason it failed; `state` ties it to the app's request. */
function answer(state: string, result: { response: unknown } | { error: string }) {
  const params = new URLSearchParams({ state });
  if ("response" in result) params.set("response", toBase64url(JSON.stringify(result.response)));
  else params.set("error", result.error);
  window.location.href = `${CALLBACK}#${params}`;
}

export default function NativeRecoveryKeyPage() {
  const [request, setRequest] = useState<Request | null>();
  const [busy, setBusy] = useState(false);

  useEffect(() => setRequest(readRequest() ?? null), []);

  if (request === undefined) return null;
  if (request === null) {
    return (
      <Screen>
        <h1>Open this from the app</h1>
        <p className="lead">This page is part of the Swissquote Wallet app. Please start from the app.</p>
      </Screen>
    );
  }

  const registering = request.mode === "register";
  async function useKey() {
    if (!request) return;
    setBusy(true);
    try {
      // WebAuthn options as the recovery provider sent them, passed straight to the browser library.
      const optionsJSON = request.options as never;
      const response = registering ? await startRegistration({ optionsJSON }) : await startAuthentication({ optionsJSON });
      answer(request.state, { response });
    } catch (err) {
      answer(request.state, { error: (err as Error).message || "The recovery key was not used." });
    }
  }

  return (
    <Screen
      actions={
        <>
          <button className="button" onClick={useKey} disabled={busy}>
            {busy ? "Waiting for your recovery key…" : registering ? "Add my recovery key" : "Use my recovery key"}
          </button>
          <button className="button secondary" onClick={() => answer(request.state, { error: "cancelled" })} disabled={busy}>
            Cancel
          </button>
        </>
      }
    >
      <h1>{registering ? "Add your recovery key" : "Your recovery key"}</h1>
      <p className="lead">
        {registering
          ? "Hold your Swissquote security key near the phone, or choose your passkey. It is registered only with the independent recovery provider."
          : "Use the recovery key you added when you opened your safe. Only you have it."}
      </p>
      <p className="protected">
        <ShieldIcon size={20} /> You go back to the app automatically afterwards.
      </p>
    </Screen>
  );
}
