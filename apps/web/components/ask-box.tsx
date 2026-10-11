"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_LANGUAGE, EXAMPLE_REQUEST, listen, voiceAvailable } from "../lib/assistant/client";
import { ArrowUpIcon, MicIcon } from "./icons";

const QUESTION = {
  en: "What would you like to do today?",
  fr: "Que souhaitez-vous faire aujourd’hui ?",
  de: "Was möchten Sie heute tun?",
  it: "Cosa desidera fare oggi?",
};

/**
 * The payment assistant, front and centre: type or say a request; the assistant screen takes it from
 * there and ends on a card the client accepts with Face ID.
 */
export function AskBox() {
  const router = useRouter();
  const [language, setLanguage] = useState<keyof typeof QUESTION>(DEFAULT_LANGUAGE);
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(false);
  const [stop, setStop] = useState<() => void>();

  useEffect(() => {
    setVoice(voiceAvailable());
  }, []);

  function send() {
    const request = text.trim();
    if (request) router.push(`/assistant?q=${encodeURIComponent(request)}`);
  }

  function toggleVoice() {
    if (stop) return stop();
    const end = listen(language, setText, () => setStop(undefined));
    setStop(() => end);
  }

  return (
    <section className="ask" aria-label="Assistant">
      <p className="ask-question">{QUESTION[language]}</p>
      <form
        className="ask-box"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE_REQUEST[language]}
          aria-label="Ask the assistant"
        />
        {voice && (
          <button type="button" className="ask-mic" aria-pressed={Boolean(stop)} aria-label="Speak your request" onClick={toggleVoice}>
            <MicIcon size={22} />
          </button>
        )}
        <button type="submit" className="ask-send" aria-label="Ask the assistant" disabled={!text.trim()}>
          <ArrowUpIcon size={22} />
        </button>
      </form>
      <p className="small muted">The assistant only prepares the payment. You confirm it with Face ID.</p>
    </section>
  );
}
