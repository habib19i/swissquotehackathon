/**
 * The assistant on the phone (CLAUDE.md section 9). The Planner (server) turns words into a draft; the
 * rules (@sqw/shared) resolve it here; the payment, exchange or Aave operation is then prepared exactly
 * like one from Send or Explore, for the confirmation card. The assistant holds no key and sends nothing.
 */
import { maxUint256, parseUnits } from "viem";
import { chfToSats } from "@sqw/bitcoin";
import { PROTOCOLS, USDC, formatEth, formatUsdc, minimumOut, quoteSwap, usdcForChf, usdcUnits } from "@sqw/ethereum";
import type { AssistantLanguage, Contact, Resolution } from "@sqw/shared";
import type { PlannerResult } from "./planner";
import { preparePayment, type PreparedPayment } from "../wallet-bitcoin";
import { loadPositions, prepareAppUse, type AppUse } from "../wallet-defi";
import { baseReader, loadUsdcBalance, prepareUsdcPayment, type UsdcPayment } from "../wallet-usdc";
import type { WalletProfile } from "../profile";

/** The assistant starts in English; the client can switch to French, German or Italian. */
export const DEFAULT_LANGUAGE: AssistantLanguage = "en";

export const EXAMPLE_REQUEST: Record<AssistantLanguage, string> = {
  en: "Send 20 francs to Léo",
  fr: "Envoie 20 francs à Léo",
  de: "Schick Léo 20 Franken",
  it: "Manda 20 franchi a Léo",
};

/** Suggestions shown before the first request, one per thing the assistant can do. */
export const SUGGESTIONS: Record<AssistantLanguage, string[]> = {
  en: ["Send 20 francs to Léo", "Exchange 1 USDC for ETH", "Put all my ETH in Aave", "Approve Uniswap", "Add a new contact"],
  fr: ["Envoie 20 francs à Léo", "Échange 1 USDC contre de l’ETH", "Place tout mon ETH sur Aave", "Approuve Uniswap", "Ajoute un nouveau contact"],
  de: ["Schick Léo 20 Franken", "Tausche 1 USDC in ETH", "Leg mein ganzes ETH auf Aave", "Gib Uniswap frei", "Füge einen neuen Kontakt hinzu"],
  it: ["Manda 20 franchi a Léo", "Cambia 1 USDC in ETH", "Metti tutti i miei ETH su Aave", "Approva Uniswap", "Aggiungi un nuovo contatto"],
};

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

// ---------------------------------------------------------------- Uniswap and Aave

/** A decimal amount as token units, without floating-point noise ("0.1", not "0.1000000000000000055"). */
const tokenUnits = (amount: number, decimals: number) =>
  parseUnits(amount.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: decimals }), decimals);

/** The resolved exchange or Aave request as a real operation, prepared exactly like one from Explore. */
export async function prepareAppPlan(
  profile: WalletProfile,
  plan: Extract<Resolution, { kind: "swap" | "earn" }>,
  prices: { usdcChf: number; ethChf: number },
): Promise<AppUse> {
  const positions = await loadPositions(profile);
  if (!positions) throw new Error("Your safe was opened before apps were available. Open a new safe to use them.");

  if (plan.kind === "swap") {
    const fromUsdc = plan.from === "USDC";
    const amountIn =
      plan.currency === "CHF"
        ? fromUsdc
          ? usdcForChf(plan.amount, prices.usdcChf)
          : tokenUnits(plan.amount / prices.ethChf, 18)
        : fromUsdc
          ? usdcUnits(plan.amount)
          : tokenUnits(plan.amount, 18);
    const have = fromUsdc ? await loadUsdcBalance(profile) : positions.eth;
    if (amountIn > have) throw new Error(`You have ${fromUsdc ? formatUsdc(have) : formatEth(have)} in your safe, not enough for this exchange.`);
    const tokenIn = fromUsdc ? USDC.address : PROTOCOLS.weth;
    const quote = await quoteSwap(baseReader, tokenIn, amountIn);
    return prepareAppUse(profile, { app: "uniswap", tokenIn, amountIn, minOut: minimumOut(quote) });
  }

  const withdraw = plan.action === "withdraw";
  const available = withdraw ? positions.ethInAave : positions.eth;
  if (available === 0n) throw new Error(withdraw ? "You have no ETH in Aave." : "You have no ETH yet. Ask me to exchange some USDC for ETH first.");
  const wanted = plan.amount === "all" ? available : tokenUnits(plan.currency === "CHF" ? plan.amount / prices.ethChf : plan.amount, 18);
  if (wanted > available) throw new Error(`You have ${formatEth(available)} ${withdraw ? "in Aave" : "in your safe"}, not enough for this.`);
  // "Everything" from Aave includes the interest earned up to the moment it is carried out.
  const amount = withdraw && wanted === available ? maxUint256 : wanted;
  return prepareAppUse(profile, { app: "aave", action: plan.action, amount });
}
