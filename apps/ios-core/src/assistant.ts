/**
 * The assistant's turn for the iOS app: the same steps as the web page's `submit()`
 * (apps/web/app/assistant/page.tsx), so both apps answer alike. The model drafts (server route), the rules
 * resolve the draft here, and a payment or app operation comes back prepared for its confirmation card.
 * The texts come from @sqw/shared's MESSAGES, in the client's language.
 */
import {
  ASSISTANT_LANGUAGES,
  MESSAGES,
  appById,
  mergeAnswer,
  resolveDraft,
  type AssistantLanguage,
  type Contact,
  type PaymentDraft,
  type Resolution,
} from "@sqw/shared";
import { DEFAULT_LANGUAGE, EXAMPLE_REQUEST, SUGGESTIONS, askPlanner, prepareAppPlan, preparePlanned } from "../../web/lib/assistant/client";
import { formatSatsAsChf } from "../../web/lib/format";
import type { WalletProfile } from "../../web/lib/profile";
import { loadRulebook } from "../../web/lib/rules";
import { NotEnoughInOnePocketError } from "../../web/lib/wallet-bitcoin";

export interface TurnInput {
  text: string;
  /** The draft waiting for an answer to the assistant's question, if any. */
  pending?: PaymentDraft;
  /** What the client said since the draft started. */
  said: string[];
  contacts: Contact[];
  language: AssistantLanguage;
  prices: { btcChf: number; usdcChf: number; ethChf: number };
}

/** A step the client takes from the chat: approve an app (Face ID), or open the contact form. */
type Action = Extract<Resolution, { kind: "trustApp" | "addContact" }>;

export interface Turn {
  reply: string;
  action?: Action;
  pending?: PaymentDraft;
  said: string[];
  language: AssistantLanguage;
  /** The model that understood the request, shown to the client. */
  model?: string;
  /** A payment ready for its confirmation card. */
  payment?: Awaited<ReturnType<typeof preparePlanned>>;
  /** An exchange or Aave operation ready for its confirmation card. */
  appUse?: { app: { id: string; name: string }; use: Awaited<ReturnType<typeof prepareAppPlan>> };
}

const LANGUAGE_NAMES: Record<AssistantLanguage, string> = { en: "English", fr: "Français", de: "Deutsch", it: "Italiano" };

/** What the chat screen shows before the first request. */
export function assistantSetup(firstName: string, language: AssistantLanguage = DEFAULT_LANGUAGE) {
  return {
    language,
    languages: ASSISTANT_LANGUAGES.map((id) => ({ id, name: LANGUAGE_NAMES[id] })),
    greeting: MESSAGES[language].greeting(firstName),
    example: EXAMPLE_REQUEST[language],
    suggestions: SUGGESTIONS[language],
  };
}

/** One of the assistant's fixed texts, e.g. `declined`, `trustButton(name)`, `trustRequested(name)`. */
export function assistantText(language: AssistantLanguage, key: string, args: unknown[] = []): string {
  const text = (MESSAGES[language] as unknown as Record<string, (...a: unknown[]) => string>)[key];
  if (typeof text !== "function") throw new Error(`Unknown assistant text ${key}.`);
  return text(...args);
}

export async function assistantTurn(profile: WalletProfile, input: TurnInput): Promise<Turn> {
  const { text, pending, contacts, prices } = input;
  let language = input.language;
  let model: string | undefined;
  try {
    // An answer to the assistant's question fills in the draft by the rules alone; a new request goes to the model.
    const said = pending ? [...input.said, text] : [text];
    let draft: PaymentDraft;
    if (pending) {
      draft = mergeAnswer(pending, text, contacts);
    } else {
      const planned = await askPlanner(text, contacts);
      draft = planned.draft;
      model = planned.model;
      // The assistant answers in the language the client writes in.
      if (planned.language) language = planned.language;
    }
    const m = MESSAGES[language];
    const resolution = resolveDraft(draft, said, contacts, language);
    const turn = { said: [] as string[], language, model };
    switch (resolution.kind) {
      case "ask":
        return { ...turn, reply: resolution.question, pending: resolution.draft, said };
      case "refuse":
        return { ...turn, reply: resolution.reason };
      case "addContact":
        return { ...turn, reply: resolution.message, action: resolution };
      case "trustApp": {
        const approved = (await loadRulebook(profile.walletId)).apps ?? [];
        return approved.includes(resolution.appId)
          ? { ...turn, reply: m.trustAlready(resolution.appName) }
          : { ...turn, reply: resolution.message, action: resolution };
      }
      case "swap":
      case "earn": {
        const app = appById(resolution.kind === "swap" ? "uniswap" : "aave")!;
        const use = await prepareAppPlan(profile, resolution, prices);
        return { ...turn, reply: resolution.message, appUse: { app: { id: app.id, name: app.name }, use } };
      }
      case "ready":
        return { ...turn, reply: resolution.message, payment: await preparePlanned(profile, resolution, prices) };
    }
  } catch (err) {
    const reply =
      err instanceof NotEnoughInOnePocketError
        ? `A payment comes from one pocket at a time: your Spending pocket can pay up to ${formatSatsAsChf(err.pocketMax, prices.btcChf)} and your Savings safe up to ${formatSatsAsChf(err.savingsMax, prices.btcChf)}.`
        : (err as Error).message;
    return { reply, said: [], language, model };
  }
}
