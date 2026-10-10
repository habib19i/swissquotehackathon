/**
 * Payment assistant rules (CLAUDE.md section 9). The language model only turns the client's words into a
 * structured draft; these rules decide what happens with it, deterministically:
 * - the recipient must be a saved contact; if none matches or the name is ambiguous, the assistant asks;
 * - the assistant never accepts an address, so no message can make it pay a stranger;
 * - safety net (from Orchestra): the recipient and the amount must come from what the client said, and
 *   the unit written next to the amount wins over the model's reading. A bitcoin amount needs "BTC" next
 *   to it; otherwise amounts are Swiss francs.
 * The confirmation card is built from the resolved draft, and Face ID is always the client's own step.
 */
import type { Contact } from "./types";

export type AssistantLanguage = "en" | "fr" | "de" | "it";
export const ASSISTANT_LANGUAGES: AssistantLanguage[] = ["en", "fr", "de", "it"];

export type DraftCurrency = "CHF" | "USDC" | "BTC";
export type DraftAsset = "BTC" | "USDC";

/** What the model returns. Untrusted: every field is checked below. */
export interface PaymentDraft {
  /** The recipient as the client named them, e.g. "Léo" or "my son". */
  recipient: string | null;
  amount: number | null;
  currency: DraftCurrency | null;
  asset: DraftAsset | null;
  pocket: "spending" | "savings" | null;
}

export const EMPTY_DRAFT: PaymentDraft = { recipient: null, amount: null, currency: null, asset: null, pocket: null };

export type Resolution =
  | { kind: "ready"; contact: Contact; amount: number; currency: DraftCurrency; asset: DraftAsset; fromSavings: boolean; message: string }
  /** The assistant needs one more answer; `draft` keeps what is already known. */
  | { kind: "ask"; question: string; draft: PaymentDraft }
  | { kind: "refuse"; reason: string };

// ---------------------------------------------------------------- language

type Relation = "Son" | "Daughter";

interface Messages {
  who(names: string): string;
  unknown(said: string, names: string): string;
  which(relation: Relation | undefined, names: string): string;
  howMuch(name: string): string;
  digits(): string;
  asset(name: string): string;
  cannotReceive(name: string, asset: DraftAsset): string;
  address(): string;
  ready(name: string): string;
  greeting(firstName: string): string;
  declined(): string;
  or: string;
}

const ASSET_NAMES: Record<AssistantLanguage, Record<DraftAsset, string>> = {
  en: { BTC: "bitcoin", USDC: "digital dollars" },
  fr: { BTC: "des bitcoins", USDC: "des dollars numériques" },
  de: { BTC: "Bitcoin", USDC: "digitale Dollar" },
  it: { BTC: "bitcoin", USDC: "dollari digitali" },
};

export const MESSAGES: Record<AssistantLanguage, Messages> = {
  en: {
    who: (names) => `Who should receive it? Your contacts: ${names}.`,
    unknown: (said, names) => `You have no contact called “${said}”. Your contacts: ${names}. Who do you mean?`,
    which: (relation, names) => (relation ? `Which ${relation === "Son" ? "son" : "daughter"}: ${names}?` : `Which one: ${names}?`),
    howMuch: (name) => `How much should ${name} receive?`,
    digits: () => "Please write the amount in digits, so I am sure: how much?",
    asset: (name) => `Should I send it to ${name} in bitcoin or in digital dollars?`,
    cannotReceive: (name, asset) => `${name} cannot receive ${ASSET_NAMES.en[asset]} yet.`,
    address: () =>
      "I can only pay people saved in your contacts. To pay someone new, add them as a contact first: Swissquote checks them for you.",
    ready: (name) => `Here is your payment to ${name}. Please check it, then accept with Face ID or decline.`,
    greeting: (first) => `Hello ${first}. Tell me who to pay and how much, for example: “Send 20 francs to Léo”.`,
    declined: () => "Declined. Nothing was sent.",
    or: "or",
  },
  fr: {
    who: (names) => `À qui dois-je l’envoyer ? Vos contacts : ${names}.`,
    unknown: (said, names) => `Vous n’avez pas de contact nommé « ${said} ». Vos contacts : ${names}. De qui parlez-vous ?`,
    which: (relation, names) => (relation ? `Quel${relation === "Son" ? "" : "le"} ${relation === "Son" ? "fils" : "fille"} : ${names} ?` : `Lequel : ${names} ?`),
    howMuch: (name) => `Combien ${name} doit-il recevoir ?`,
    digits: () => "Merci d’écrire le montant en chiffres, pour que je sois sûr : combien ?",
    asset: (name) => `Dois-je l’envoyer à ${name} en bitcoins ou en dollars numériques ?`,
    cannotReceive: (name, asset) => `${name} ne peut pas encore recevoir ${ASSET_NAMES.fr[asset]}.`,
    address: () =>
      "Je ne peux payer que les personnes enregistrées dans vos contacts. Pour payer quelqu’un de nouveau, ajoutez-le d’abord : Swissquote le vérifie pour vous.",
    ready: (name) => `Voici votre paiement à ${name}. Vérifiez-le, puis acceptez avec Face ID ou refusez.`,
    greeting: (first) => `Bonjour ${first}. Dites-moi qui payer et combien, par exemple : « Envoie 20 francs à Léo ».`,
    declined: () => "Refusé. Rien n’a été envoyé.",
    or: "ou",
  },
  de: {
    who: (names) => `Wer soll es erhalten? Ihre Kontakte: ${names}.`,
    unknown: (said, names) => `Sie haben keinen Kontakt namens «${said}». Ihre Kontakte: ${names}. Wen meinen Sie?`,
    which: (relation, names) => (relation ? `Welche${relation === "Son" ? "r Sohn" : " Tochter"}: ${names}?` : `Welche Person: ${names}?`),
    howMuch: (name) => `Wie viel soll ${name} erhalten?`,
    digits: () => "Bitte schreiben Sie den Betrag in Ziffern, damit ich sicher bin: wie viel?",
    asset: (name) => `Soll ich es ${name} in Bitcoin oder in digitalen Dollar senden?`,
    cannotReceive: (name, asset) => `${name} kann noch keine ${ASSET_NAMES.de[asset]} empfangen.`,
    address: () =>
      "Ich kann nur Personen aus Ihren Kontakten bezahlen. Um jemand Neues zu bezahlen, fügen Sie die Person zuerst hinzu: Swissquote prüft sie für Sie.",
    ready: (name) => `Hier ist Ihre Zahlung an ${name}. Bitte prüfen Sie sie und bestätigen Sie mit Face ID oder lehnen Sie ab.`,
    greeting: (first) => `Grüezi ${first}. Sagen Sie mir, wen ich wie viel bezahlen soll, zum Beispiel: «Schick Léo 20 Franken».`,
    declined: () => "Abgelehnt. Es wurde nichts gesendet.",
    or: "oder",
  },
  it: {
    who: (names) => `A chi devo inviarlo? I suoi contatti: ${names}.`,
    unknown: (said, names) => `Non ha un contatto chiamato «${said}». I suoi contatti: ${names}. Chi intende?`,
    which: (relation, names) => (relation ? `Quale ${relation === "Son" ? "figlio" : "figlia"}: ${names}?` : `Quale: ${names}?`),
    howMuch: (name) => `Quanto deve ricevere ${name}?`,
    digits: () => "Per favore scriva l’importo in cifre, così sono sicuro: quanto?",
    asset: (name) => `Devo inviarlo a ${name} in bitcoin o in dollari digitali?`,
    cannotReceive: (name, asset) => `${name} non può ancora ricevere ${ASSET_NAMES.it[asset]}.`,
    address: () =>
      "Posso pagare solo le persone salvate nei suoi contatti. Per pagare qualcuno di nuovo, lo aggiunga prima: Swissquote lo verifica per lei.",
    ready: (name) => `Ecco il suo pagamento a ${name}. Lo controlli, poi accetti con Face ID o rifiuti.`,
    greeting: (first) => `Buongiorno ${first}. Mi dica chi pagare e quanto, per esempio: «Manda 20 franchi a Léo».`,
    declined: () => "Rifiutato. Non è stato inviato nulla.",
    or: "o",
  },
};

// ---------------------------------------------------------------- reading the client's words

/** Lower case, accents removed: "Léo" and "leo" match. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** Words of a text, trailing punctuation removed ("USDC." is "usdc", "Léo's" is "leo"). */
const words = (s: string) =>
  normalize(s)
    .split(/[^\p{L}\p{N}.,'’]+/u)
    .map((w) => w.replace(/['’]s$/, "").replace(/[.,'’]+$/, ""))
    .filter(Boolean);

/** Bitcoin and Ethereum addresses: the assistant never takes one. */
const ADDRESS = /0x[0-9a-f]{40}|\b(?:bc1|tb1|bcrt1)[0-9a-z]{20,}|\b[13mn2][a-km-zA-HJ-NP-Z1-9]{25,34}\b/i;
export const containsAddress = (text: string) => ADDRESS.test(text);

const RELATION_WORDS: Record<Relation, string[]> = {
  Son: ["son", "sons", "fils", "sohn", "sohne", "figlio"],
  Daughter: ["daughter", "daughters", "fille", "filles", "tochter", "tochtern", "figlia", "figlie"],
};
const CHILDREN_WORDS = ["child", "children", "kid", "kids", "enfant", "enfants", "kind", "kinder", "figli", "bambini"];

const UNIT_WORDS: Record<DraftCurrency, string[]> = {
  CHF: ["chf", "fr", "franc", "francs", "franken", "franchi", "franco"],
  USDC: ["usdc", "usd", "dollar", "dollars", "dollaro", "dollari"],
  BTC: ["btc", "bitcoin", "bitcoins"],
};
const SAVINGS_WORDS = ["savings", "epargne", "sparen", "ersparnisse", "spartresor", "tresor", "risparmi", "risparmio", "coffre"];

/** Numbers as written by the client: 50, 12.50, 12,50, 1'000, 0.001. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d+(?:['’]\d{3})*(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(/['’]/g, "").replace(",", ".")));
}

/** The unit written right next to the amount ("50 USDC", "CHF 20", "20 francs"), if any. */
function unitNextTo(text: string, amount: number): DraftCurrency | null {
  const tokens = words(text);
  for (let i = 0; i < tokens.length; i++) {
    const n = numbersIn(tokens[i])[0];
    if (n === undefined || Math.abs(n - amount) > 1e-9) continue;
    for (const neighbour of [tokens[i + 1], tokens[i - 1]]) {
      const unit = (Object.keys(UNIT_WORDS) as DraftCurrency[]).find((u) => neighbour && UNIT_WORDS[u].includes(neighbour));
      if (unit) return unit;
    }
  }
  return null;
}

const mentions = (text: string, list: string[]) => words(text).some((w) => list.includes(w));

function assetIn(text: string): DraftAsset | null {
  const t = normalize(text);
  if (/\bbitcoins?\b|\bbtc\b/.test(t)) return "BTC";
  if (/\busdc\b|dollar|dollari/.test(t)) return "USDC";
  return null;
}

// ---------------------------------------------------------------- recipients

function relationOf(said: string): Relation | "children" | undefined {
  if (mentions(said, RELATION_WORDS.Son)) return "Son";
  if (mentions(said, RELATION_WORDS.Daughter)) return "Daughter";
  if (mentions(said, CHILDREN_WORDS)) return "children";
  return undefined;
}

const namedIn = (text: string, contacts: Contact[]) => {
  const said = words(text);
  return contacts.filter((c) => words(c.name).every((part) => said.includes(part)));
};

function candidatesFor(said: string, contacts: Contact[]): { matches: Contact[]; relation?: Relation } {
  const byName = namedIn(said, contacts);
  if (byName.length) return { matches: byName };
  const relation = relationOf(said);
  if (relation === "children") return { matches: contacts.filter((c) => c.relation === "Son" || c.relation === "Daughter") };
  if (relation) return { matches: contacts.filter((c) => c.relation === relation), relation };
  return { matches: [] };
}

function list(names: string[], or: string): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} ${or} ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------- resolving

/**
 * Applies the rules to the model's draft. `said` holds everything the client wrote in this conversation:
 * the safety net checks the draft against it, never against the model's own words.
 */
export function resolveDraft(draft: PaymentDraft, said: string[], contacts: Contact[], language: AssistantLanguage): Resolution {
  const m = MESSAGES[language];
  const text = said.join("\n");
  const everyone = list(
    contacts.map((c) => c.name),
    m.or,
  );
  if (said.some(containsAddress) || (draft.recipient && containsAddress(draft.recipient))) return { kind: "refuse", reason: m.address() };

  // Recipient: a saved contact, named by the client.
  const fromText = namedIn(text, contacts);
  const { matches, relation } = draft.recipient
    ? candidatesFor(draft.recipient, contacts)
    : fromText.length
      ? { matches: fromText, relation: undefined }
      : candidatesFor(text, contacts);
  if (matches.length === 0) {
    return { kind: "ask", draft, question: draft.recipient ? m.unknown(draft.recipient, everyone) : m.who(everyone) };
  }
  if (matches.length > 1) {
    return { kind: "ask", draft, question: m.which(relation, list(matches.map((c) => c.name), m.or)) };
  }
  const contact = matches[0];
  // The model may only point at someone the client named, by name or by relation.
  const relationSaid = relationOf(text);
  const saidByClient =
    namedIn(text, [contact]).length > 0 ||
    (relationSaid === "children" ? contact.relation === "Son" || contact.relation === "Daughter" : relationSaid === contact.relation);
  if (!saidByClient) return { kind: "ask", draft: { ...draft, recipient: null }, question: m.who(everyone) };
  const named = { ...draft, recipient: contact.name };

  // Amount: what the client wrote, never a number the model came up with.
  if (draft.amount === null || !(draft.amount > 0)) return { kind: "ask", draft: named, question: m.howMuch(contact.name) };
  if (!numbersIn(text).some((n) => Math.abs(n - draft.amount!) < 1e-9)) {
    return { kind: "ask", draft: { ...named, amount: null }, question: m.digits() };
  }
  // The unit next to the amount decides. The model's reading counts only for francs or dollars the client
  // mentioned; never for bitcoin, whose amounts are worth thousands of times more.
  const modelUnit = draft.currency && draft.currency !== "BTC" && mentions(text, UNIT_WORDS[draft.currency]) ? draft.currency : null;
  const currency = unitNextTo(text, draft.amount) ?? modelUnit ?? "CHF";

  // Asset: the unit decides, then the client's words, then what the contact can receive.
  const receivable: DraftAsset[] = [...(contact.btcAddress ? ["BTC" as const] : []), ...(contact.ethAddress ? ["USDC" as const] : [])];
  const asset: DraftAsset | null = currency !== "CHF" ? currency : (assetIn(text) ?? draft.asset ?? (receivable.length === 1 ? receivable[0] : null));
  if (!asset) return { kind: "ask", draft: { ...named, currency }, question: m.asset(contact.name) };
  if (!receivable.includes(asset)) return { kind: "refuse", reason: m.cannotReceive(contact.name, asset) };

  const fromSavings = asset === "BTC" && mentions(text, SAVINGS_WORDS);
  return { kind: "ready", contact, amount: draft.amount, currency, asset, fromSavings, message: m.ready(contact.name) };
}

/**
 * The client's answer to a question fills in what was missing, without asking the model again:
 * a contact's name, an amount, a unit.
 */
export function mergeAnswer(draft: PaymentDraft, answer: string, contacts: Contact[]): PaymentDraft {
  const named = namedIn(answer, contacts);
  const amount = numbersIn(answer)[0];
  const unit = amount !== undefined ? unitNextTo(answer, amount) : null;
  return {
    recipient: named.length === 1 ? named[0].name : (draft.recipient ?? (relationOf(answer) ? answer : null)),
    amount: draft.amount ?? amount ?? null,
    currency: unit ?? draft.currency,
    asset: assetIn(answer) ?? draft.asset,
    pocket: draft.pocket,
  };
}

/** Checks the model's JSON field by field; anything unexpected becomes null. */
export function sanitizeDraft(value: unknown): PaymentDraft {
  const v = (value ?? {}) as Record<string, unknown>;
  const oneOf = <T extends string>(x: unknown, options: readonly T[]): T | null => (options.includes(x as T) ? (x as T) : null);
  const amount = typeof v.amount === "number" ? v.amount : typeof v.amount === "string" ? Number(v.amount.replace(",", ".")) : NaN;
  return {
    recipient: typeof v.recipient === "string" && v.recipient.trim() ? v.recipient.trim().slice(0, 80) : null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: oneOf(v.currency, ["CHF", "USDC", "BTC"] as const),
    asset: oneOf(v.asset, ["BTC", "USDC"] as const),
    pocket: oneOf(v.pocket, ["spending", "savings"] as const),
  };
}
