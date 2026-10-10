"use client";

import { useEffect, useRef, useState } from "react";
import {
  ASSISTANT_LANGUAGES,
  MESSAGES,
  mergeAnswer,
  resolveDraft,
  type AssistantLanguage,
  type Contact,
  type EthSent,
  type PaymentDraft,
} from "@sqw/shared";
import { MicIcon, SendIcon } from "../../components/icons";
import { Mock, Screen } from "../../components/screen";
import { RequireWallet } from "../../components/wallet-context";
import { askPlanner, listen, preparePlanned, voiceAvailable, type AssistantPayment } from "../../lib/assistant/client";
import type { WalletProfile } from "../../lib/profile";
import { loadRulebook } from "../../lib/rules";
import { usePrice } from "../../lib/use-price";
import { formatSatsAsChf } from "../../lib/format";
import { NotEnoughInOnePocketError, type PaymentResult } from "../../lib/wallet-bitcoin";
import { BitcoinConfirm, BitcoinSent } from "../send/bitcoin";
import { UsdcConfirm, UsdcSent } from "../send/usdc";

export default function AssistantPage() {
  return <RequireWallet>{(profile) => <Assistant profile={profile} />}</RequireWallet>;
}

interface Message {
  from: "client" | "assistant";
  text: string;
}

type Phase =
  | { name: "chat" }
  | { name: "confirm"; planned: AssistantPayment }
  | { name: "sent-btc"; planned: Extract<AssistantPayment, { asset: "BTC" }>; result: PaymentResult }
  | { name: "sent-usdc"; planned: Extract<AssistantPayment, { asset: "USDC" }>; sent: EthSent };

const LANGUAGE_NAMES: Record<AssistantLanguage, string> = { en: "English", fr: "Français", de: "Deutsch", it: "Italiano" };

function browserLanguage(): AssistantLanguage {
  const code = typeof navigator === "undefined" ? "en" : navigator.language.slice(0, 2);
  return ASSISTANT_LANGUAGES.includes(code as AssistantLanguage) ? (code as AssistantLanguage) : "en";
}

/**
 * The payment assistant (CLAUDE.md section 9): "Send 50 USDC to my son". The model drafts, the rules
 * decide, and the client accepts the card with Face ID or declines. No message can skip that step.
 */
function Assistant({ profile }: { profile: WalletProfile }) {
  const price = usePrice();
  const firstName = profile.client.name.split(" ")[0];
  const [language, setLanguage] = useState<AssistantLanguage>(browserLanguage);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>(() => [{ from: "assistant", text: MESSAGES[browserLanguage()].greeting(firstName) }]);
  const [said, setSaid] = useState<string[]>([]);
  const [pending, setPending] = useState<PaymentDraft>();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState<() => void>();
  const [model, setModel] = useState<string>();
  const [phase, setPhase] = useState<Phase>({ name: "chat" });
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadRulebook(profile.walletId).then((rb) => setContacts(rb.contacts));
  }, [profile]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const say = (text: string) => setMessages((m) => [...m, { from: "assistant", text }]);

  function chooseLanguage(next: AssistantLanguage) {
    setLanguage(next);
    if (messages.length === 1) setMessages([{ from: "assistant", text: MESSAGES[next].greeting(firstName) }]);
  }

  async function submit(text: string) {
    if (!text.trim() || busy || !price) return;
    listening?.();
    setInput("");
    setMessages((m) => [...m, { from: "client", text }]);
    setBusy(true);
    try {
      // An answer to the assistant's question fills in the draft by the rules alone; a new request goes to the model.
      let draft: PaymentDraft;
      let lang = language;
      const conversation = pending ? [...said, text] : [text];
      if (pending) {
        draft = mergeAnswer(pending, text, contacts);
      } else {
        const planned = await askPlanner(text, contacts);
        draft = planned.draft;
        setModel(planned.model);
        if (planned.language && planned.language !== language) {
          lang = planned.language;
          setLanguage(lang);
        }
      }
      setSaid(conversation);

      const resolution = resolveDraft(draft, conversation, contacts, lang);
      if (resolution.kind === "ask") {
        setPending(resolution.draft);
        say(resolution.question);
        return;
      }
      setPending(undefined);
      setSaid([]);
      if (resolution.kind === "refuse") {
        say(resolution.reason);
        return;
      }
      say(resolution.message);
      setPhase({ name: "confirm", planned: await preparePlanned(profile, resolution, price) });
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

  return (
    <Screen
      back={{ href: "/" }}
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
              placeholder={language === "fr" ? "Envoie 20 francs à Léo" : language === "de" ? "Schick Léo 20 Franken" : language === "it" ? "Manda 20 franchi a Léo" : "Send 20 francs to Léo"}
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
            The assistant only prepares a payment card. Nothing is sent until you accept it with Face ID.
          </p>
        </>
      }
    >
      <h1>Payment assistant</h1>
      <div className="segmented" role="group" aria-label="Language">
        {ASSISTANT_LANGUAGES.map((l) => (
          <button key={l} aria-pressed={language === l} onClick={() => chooseLanguage(l)}>
            {LANGUAGE_NAMES[l]}
          </button>
        ))}
      </div>

      <div className="chat" aria-live="polite">
        {messages.map((m, i) => (
          <p key={i} className={`bubble ${m.from}`}>
            {m.text}
          </p>
        ))}
        {busy && <p className="bubble assistant muted">…</p>}
        <div ref={bottom} />
      </div>

      <p className="small muted">
        {model ? `Understood by ${model}. ` : ""}
        {!model || !/apertus/i.test(model) ? "In production: Apertus, the Swiss open model, hosted in Switzerland. " : ""}
        The model only sees your request and your contacts&rsquo; first names, never who you are.
        {voiceAvailable() && (
          <>
            {" "}
            Voice uses your browser&rsquo;s speech recognition <Mock>Mock of Swiss-hosted speech-to-text</Mock>.
          </>
        )}
      </p>
    </Screen>
  );
}
