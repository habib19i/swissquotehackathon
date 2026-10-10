/**
 * The payment assistant on the phone (CLAUDE.md section 9). The Planner (server) turns words into a
 * draft; the rules (@sqw/shared) resolve it here; the payment is then prepared like any other, for the
 * confirmation card. The assistant holds no key and sends nothing.
 */
import { chfToSats } from "@sqw/bitcoin";
import { usdcForChf, usdcUnits } from "@sqw/ethereum";
import type { AssistantLanguage, Contact, Resolution } from "@sqw/shared";
import type { PlannerResult } from "./planner";
import { preparePayment, type PreparedPayment } from "../wallet-bitcoin";
import { prepareUsdcPayment, type UsdcPayment } from "../wallet-usdc";
import type { WalletProfile } from "../profile";

/** Sends the request text and the contacts' first names only. */
export async function askPlanner(text: string, contacts: Contact[]): Promise<PlannerResult> {
  const res = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, contacts: contacts.map((c) => ({ name: c.name })) }),
  }).catch(() => undefined);
  const body = await res?.json().catch(() => ({}));
  if (!res?.ok) throw new Error(body?.error ?? "The assistant could not be reached right now.");
  return body as PlannerResult;
}

export type AssistantPayment = { asset: "BTC"; payment: PreparedPayment } | { asset: "USDC"; payment: UsdcPayment };

/** The resolved draft as a real payment, built exactly like one from the Send screen. */
export async function preparePlanned(
  profile: WalletProfile,
  ready: Extract<Resolution, { kind: "ready" }>,
  prices: { btcChf: number; usdcChf: number },
): Promise<AssistantPayment> {
  const { contact, amount, currency } = ready;
  if (ready.asset === "BTC") {
    const sats = currency === "BTC" ? BigInt(Math.round(amount * 1e8)) : chfToSats(amount, prices.btcChf);
    return { asset: "BTC", payment: await preparePayment(profile, contact, sats, ready.fromSavings ? "savings" : undefined) };
  }
  const units = currency === "USDC" ? usdcUnits(amount) : usdcForChf(amount, prices.usdcChf);
  return { asset: "USDC", payment: await prepareUsdcPayment(profile, contact, units) };
}

// ---------------------------------------------------------------- voice

/** MOCK of Swiss-hosted speech-to-text: the browser's own speech recognition. */
interface Recognition {
  lang: string;
  interimResults: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

const LOCALES: Record<AssistantLanguage, string> = { en: "en-GB", fr: "fr-CH", de: "de-CH", it: "it-CH" };

function recognitionClass(): (new () => Recognition) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const voiceAvailable = () => recognitionClass() !== undefined;

/** Listens once; returns a function that stops listening. */
export function listen(
  language: AssistantLanguage,
  onText: (text: string) => void,
  onEnd: (error?: string) => void,
): () => void {
  const Recognition = recognitionClass();
  if (!Recognition) {
    onEnd("Voice is not available in this browser. Please type instead.");
    return () => {};
  }
  const recognition = new Recognition();
  recognition.lang = LOCALES[language];
  recognition.interimResults = true;
  recognition.onresult = (event) => onText(Array.from(event.results, (r) => r[0].transcript).join(""));
  recognition.onerror = (event) => onEnd(event.error === "not-allowed" ? "Please allow the microphone to speak to the assistant." : undefined);
  recognition.onend = () => onEnd();
  recognition.start();
  return () => recognition.stop();
}
