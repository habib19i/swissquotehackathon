"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ASSISTANT_LANGUAGES,
  MESSAGES,
  appById,
  mergeAnswer,
  resolveDraft,
  type AssistantLanguage,
  type Contact,
  type DefiApp,
  type EthSent,
  type PaymentDraft,
  type Resolution,
} from "@sqw/shared";
import { AppConfirm, AppDone } from "../../components/app-confirm";
import { MicIcon, SendIcon } from "../../components/icons";
import { Mock, Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import {
  DEFAULT_LANGUAGE,
  EXAMPLE_REQUEST,
  SUGGESTIONS,
  askPlanner,
  listen,
  prepareAppPlan,
  preparePlanned,
  voiceAvailable,
  type AssistantPayment,
} from "../../lib/assistant/client";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook, requestChange } from "../../lib/rules";
import { usePrice } from "../../lib/use-price";
import { formatSatsAsChf } from "../../lib/format";
import { NotEnoughInOnePocketError, type PaymentResult } from "../../lib/wallet-bitcoin";
import type { AppUse } from "../../lib/wallet-defi";
import { BitcoinConfirm, BitcoinSent } from "../send/bitcoin";
import { UsdcConfirm, UsdcSent } from "../send/usdc";

export default function AssistantPage() {
  return <RequireWallet>{(profile) => <Assistant profile={profile} />}</RequireWallet>;
}

/** A step the client takes from the chat: approving an app (Face ID), or opening the contact form. */
type Action = Extract<Resolution, { kind: "trustApp" | "addContact" }>;

interface Message {
  from: "client" | "assistant";
  text: string;
  action?: Action;
}

type Phase =
  | { name: "chat" }
  | { name: "confirm"; planned: AssistantPayment }
  | { name: "sent-btc"; planned: Extract<AssistantPayment, { asset: "BTC" }>; result: PaymentResult }
  | { name: "sent-usdc"; planned: Extract<AssistantPayment, { asset: "USDC" }>; sent: EthSent }
  | { name: "app-confirm"; app: DefiApp; use: AppUse }
  | { name: "app-done"; app: DefiApp; use: AppUse; sent: EthSent };

const LANGUAGE_NAMES: Record<AssistantLanguage, string> = { en: "English", fr: "Français", de: "Deutsch", it: "Italiano" };

/**
 * The assistant (CLAUDE.md section 9): "Send 50 USDC to my son", "Exchange 5 USDC for ETH", "Put my ETH
 * in Aave", "Approve Uniswap", "Add Marc as a contact". The model drafts, the rules decide, and the client
 * confirms each step with Face ID or declines. No message can skip that step.
 */
function Assistant({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const firstName = profile.client.name.split(" ")[0];
  const [language, setLanguage] = useState<AssistantLanguage>(DEFAULT_LANGUAGE);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>(() => [{ from: "assistant", text: MESSAGES[DEFAULT_LANGUAGE].greeting(firstName) }]);
  const [said, setSaid] = useState<string[]>([]);
  const [pending, setPending] = useState<PaymentDraft>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState<() => void>();
  const [model, setModel] = useState<string>();
  const [phase, setPhase] = useState<Phase>({ name: "chat" });
  const bottom = useRef<HTMLDivElement>(null);
  const started = messages.length > 1;

  useEffect(() => {
    loadRulebook(profile.walletId).then((rb) => setContacts(rb.contacts));
  }, [profile]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // A request typed in the home screen's box: asked once, as soon as contacts and prices are known.
  const handedOver = useRef(false);
  useEffect(() => {
    const request = new URLSearchParams(window.location.search).get("q");
    if (!request || handedOver.current || contacts.length === 0 || !price) return;
    handedOver.current = true;
    window.history.replaceState(null, "", "/assistant");
    submit(request);
  });

  const say = (text: string, action?: Action) => setMessages((m) => [...m, { from: "assistant", text, action }]);

  function chooseLanguage(next: AssistantLanguage) {
    setLanguage(next);
    if (!started) setMessages([{ from: "assistant", text: MESSAGES[next].greeting(firstName) }]);
  }

  async function submit(text: string) {
    if (!text.trim() || busy || !price) return;
    listening?.();
    setInput("");
    setMessages((m) => [...m, { from: "client", text }]);
    setBusy(true);
    let lang = language;
    try {
      // An answer to the assistant's question fills in the draft by the rules alone; a new request goes to the model.
      let draft: PaymentDraft;
      const conversation = pending ? [...said, text] : [text];
      if (pending) {
        draft = mergeAnswer(pending, text, contacts);
      } else {
        const planned = await askPlanner(text, contacts);
        draft = planned.draft;
        setModel(planned.model);
        // The assistant answers in the language the client writes in.
        if (planned.language) {
          lang = planned.language;
          setLanguage(lang);
        }
      }
      setSaid(conversation);

      const m = MESSAGES[lang];
      const resolution = resolveDraft(draft, conversation, contacts, lang);
      if (resolution.kind === "ask") {
        setPending(resolution.draft);
        say(resolution.question);
        return;
      }
      setPending(undefined);
      setSaid([]);
      switch (resolution.kind) {
        case "refuse":
          say(resolution.reason);
          return;
        case "addContact":
          say(resolution.message, resolution);
          return;
        case "trustApp": {
          const approved = (await loadRulebook(profile.walletId)).apps ?? [];
          if (approved.includes(resolution.appId)) say(m.trustAlready(resolution.appName));
          else say(resolution.message, resolution);
          return;
        }
        case "swap":
        case "earn": {
          const app = appById(resolution.kind === "swap" ? "uniswap" : "aave")!;
          const use = await prepareAppPlan(profile, resolution, price);
          say(resolution.message);
          setPhase({ name: "app-confirm", app, use });
          return;
        }
        case "ready":
          say(resolution.message);
          setPhase({ name: "confirm", planned: await preparePlanned(profile, resolution, price) });
      }
    } catch (err) {
      setPending(undefined);
      setSaid([]);
      say(
        err instanceof NotEnoughInOnePocketError
          ? `A payment comes from one pocket at a time: your Spending pocket can pay up to ${formatSatsAsChf(err.pocketMax, price.btcChf)} and your Savings safe up to ${formatSatsAsChf(err.savingsMax, price.btcChf)}.`
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }

  function decline() {
    say(MESSAGES[language].declined());
    setPhase({ name: "chat" });
  }

  function toggleVoice() {
    if (listening) {
      listening();
      return;
    }
    const stop = listen(language, setInput, (error) => {
      setListening(undefined);
      if (error) say(error);
    });
    setListening(() => stop);
  }

  if (phase.name === "confirm") {
    const { planned } = phase;
    return planned.asset === "BTC" ? (
      <BitcoinConfirm
        profile={profile}
        payment={planned.payment}
        onCancel={decline}
        onSent={(result) => setPhase({ name: "sent-btc", planned, result })}
      />
    ) : (
      <UsdcConfirm profile={profile} payment={planned.payment} onCancel={decline} onSent={(sent) => setPhase({ name: "sent-usdc", planned, sent })} />
    );
  }
  if (phase.name === "sent-btc") return <BitcoinSent payment={phase.planned.payment} result={phase.result} />;
  if (phase.name === "sent-usdc") return <UsdcSent payment={phase.planned.payment} sent={phase.sent} />;
  if (phase.name === "app-confirm") {
    const { app, use } = phase;
    return <AppConfirm profile={profile} app={app} use={use} onCancel={decline} onSent={(sent) => setPhase({ name: "app-done", app, use, sent })} />;
  }
  if (phase.name === "app-done") return <AppDone app={phase.app} use={phase.use} sent={phase.sent} />;

  return (
    <Screen
      tabs
      actions={
        <>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <input
              className="input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={EXAMPLE_REQUEST[language]}
              aria-label="Your request"
              disabled={busy}
            />
            {voiceAvailable() && (
              <button type="button" className="icon-button" aria-pressed={Boolean(listening)} aria-label="Speak your request" onClick={toggleVoice} disabled={busy}>
                <MicIcon />
              </button>
            )}
            <button type="submit" className="icon-button" aria-label="Send to the assistant" disabled={busy || !input.trim() || !price}>
              <SendIcon />
            </button>
          </form>
          <p className="small muted">
            The assistant only prepares. Nothing happens until you confirm with Face ID.
            {voiceAvailable() && (
              <>
                {" "}
                Voice: <Mock>Browser speech recognition</Mock>
              </>
            )}
          </p>
        </>
      }
    >
      <header className="assistant-head">
        <h1>Assistant</h1>
        <label className="language-pick">
          <span className="visually-hidden">Language</span>
          <select value={language} onChange={(e) => chooseLanguage(e.target.value as AssistantLanguage)}>
            {ASSISTANT_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.from}`}>
            <p>{m.text}</p>
            {m.action && <ChatAction profile={profile} action={m.action} language={language} onDone={(text) => say(text)} />}
          </div>
        ))}
        {busy && <p className="bubble assistant muted">…</p>}
        <div ref={bottom} />
      </div>

      {!started && (
        <div className="suggestions" aria-label="Suggestions">
          {SUGGESTIONS[language].map((s) => (
            <button key={s} className="suggestion" onClick={() => submit(s)} disabled={busy || !price}>
              {s}
            </button>
          ))}
        </div>
      )}

      {model && (
        <p className="small muted">
          Understood by {model}. It only sees your request and your contacts&rsquo; first names, never who you are.
        </p>
      )}
    </Screen>
  );
}

/** The step a chat message offers: approve an app with Face ID, or open the contact form with the name filled in. */
function ChatAction({ profile, action, language, onDone }: { profile: WalletProfile; action: Action; language: AssistantLanguage; onDone: (text: string) => void }) {
  const m = MESSAGES[language];
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  if (action.kind === "addContact") {
    return (
      <Link href={`/rules?add=${encodeURIComponent(action.name)}`} className="button secondary bubble-action">
        {m.newContactButton(action.name)}
      </Link>
    );
  }
  if (state === "done") return null;
  return (
    <button
      className="button bubble-action"
      disabled={state === "busy"}
      onClick={async () => {
        setState("busy");
        try {
          await requestChange(profile, { kind: "addApp", appId: action.appId });
          setState("done");
          onDone(m.trustRequested(action.appName));
        } catch (err) {
          setState("idle");
          onDone((err as Error).message);
        }
      }}
    >
      {state === "busy" ? "Waiting for Face ID…" : m.trustButton(action.appName)}
    </button>
  );
}
