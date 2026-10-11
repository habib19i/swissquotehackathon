/**
 * Assistant rules (CLAUDE.md section 9). The language model only turns the client's words into a
 * structured draft: a payment, an exchange on Uniswap, earning on Aave, trusting an app, or adding a
 * contact. These rules decide what happens with it, deterministically:
 * - the recipient must be a saved contact; if none matches or the name is ambiguous, the assistant asks;
 * - the assistant never accepts an address, so no message can make it pay a stranger;
 * - safety net (from Orchestra): the recipient and the amount must come from what the client said, and
 *   the unit written next to the amount wins over the model's reading. A bitcoin amount needs "BTC" next
 *   to it; otherwise amounts are Swiss francs.
 * - exchanges and Aave only ever return funds to the client's own safe (the vetted adapters ensure it);
 * - a new contact's address is never taken from the chat: the client types it in the form, where
 *   Swissquote screens it, and it then waits out the usual delay.
 * The confirmation card is built from the resolved draft, and Face ID is always the client's own step.
 */
import { APPS } from "./apps";
import type { Contact } from "./types";

export type AssistantLanguage = "en" | "fr" | "de" | "it";
export const ASSISTANT_LANGUAGES: AssistantLanguage[] = ["en", "fr", "de", "it"];

export type DraftCurrency = "CHF" | "USDC" | "BTC" | "ETH";
export type DraftAsset = "BTC" | "USDC";
/** What the client asks for: pay a contact, exchange on Uniswap, deposit in or withdraw from Aave, trust an app, add a contact. */
export type AssistantIntent = "pay" | "swap" | "earn" | "withdraw" | "trustApp" | "addContact";
export const ASSISTANT_INTENTS: AssistantIntent[] = ["pay", "swap", "earn", "withdraw", "trustApp", "addContact"];
/** The two tokens exchanged on Uniswap. */
export type SwapToken = "USDC" | "ETH";

/** What the model returns. Untrusted: every field is checked below. */
export interface PaymentDraft {
  intent: AssistantIntent;
  /** The recipient as the client named them, e.g. "Léo" or "my son"; for addContact, the new person's name. */
  recipient: string | null;
  amount: number | null;
  currency: DraftCurrency | null;
  asset: DraftAsset | null;
  pocket: "spending" | "savings" | null;
  /** The app named by the client, e.g. "Uniswap" (trustApp). */
  app: string | null;
  /** The token the client gives in an exchange. */
  from: SwapToken | null;
}

export const EMPTY_DRAFT: PaymentDraft = { intent: "pay", recipient: null, amount: null, currency: null, asset: null, pocket: null, app: null, from: null };

export type Resolution =
  | { kind: "ready"; contact: Contact; amount: number; currency: DraftCurrency; asset: DraftAsset; fromSavings: boolean; message: string }
  /** Exchange on Uniswap: `amount` in `currency` (the token given, or francs). */
  | { kind: "swap"; from: SwapToken; amount: number; currency: SwapToken | "CHF"; message: string }
  /** Aave: deposit or withdraw ETH; "all" is everything available. */
  | { kind: "earn"; action: "supply" | "withdraw"; amount: number | "all"; currency: "ETH" | "CHF"; message: string }
  /** Approve a vetted app for Face ID use (a loosening change: delay, alerts). */
  | { kind: "trustApp"; appId: string; appName: string; message: string }
  /** Open the contact form with this name; the address is typed there, never in the chat. */
  | { kind: "addContact"; name: string; message: string }
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
  swapDirection(): string;
  swapHowMuch(from: SwapToken): string;
  swapReady(): string;
  swapOnly(): string;
  ethPayment(): string;
  earnHowMuch(withdraw: boolean): string;
  earnUnit(): string;
  earnReady(withdraw: boolean): string;
  earnOnlyEth(): string;
  trustWhich(names: string): string;
  trustNotLive(name: string): string;
  trustReady(name: string): string;
  trustButton(name: string): string;
  trustRequested(name: string): string;
  trustAlready(name: string): string;
  newContactButton(name: string): string;
  newContactWho(): string;
  newContactKnown(name: string): string;
  newContactReady(name: string, addressSaid: boolean): string;
  or: string;
}

const ASSET_NAMES: Record<AssistantLanguage, Record<DraftAsset, string>> = {
  en: { BTC: "bitcoin", USDC: "USDC" },
  fr: { BTC: "des bitcoins", USDC: "des USDC" },
  de: { BTC: "Bitcoin", USDC: "USDC" },
  it: { BTC: "bitcoin", USDC: "USDC" },
};

export const MESSAGES: Record<AssistantLanguage, Messages> = {
  en: {
    who: (names) => `Who should receive it? Your contacts: ${names}.`,
    unknown: (said, names) => `You have no contact called “${said}”. Your contacts: ${names}. Who do you mean?`,
    which: (relation, names) => (relation ? `Which ${relation === "Son" ? "son" : "daughter"}: ${names}?` : `Which one: ${names}?`),
    howMuch: (name) => `How much should ${name} receive?`,
    digits: () => "Please write the amount in digits, so I am sure: how much?",
    asset: (name) => `Should I send it to ${name} in bitcoin or in USDC?`,
    cannotReceive: (name, asset) => `${name} cannot receive ${ASSET_NAMES.en[asset]} yet.`,
    address: () =>
      "I can only pay people saved in your contacts. To pay someone new, add them as a contact first: Swissquote checks them for you.",
    ready: (name) => `Here is your payment to ${name}. Please check it, then accept with Face ID or decline.`,
    greeting: (first) =>
      `Hello ${first}. I can pay a contact, exchange USDC and ETH on Uniswap, earn interest on Aave, approve an app or add a contact. For example: “Send 20 francs to Léo” or “Exchange 5 USDC for ETH”.`,
    declined: () => "Declined. Nothing was sent.",
    swapDirection: () => "Should I exchange USDC for ETH, or ETH for USDC?",
    swapHowMuch: (from) => `How much ${from} should I exchange?`,
    swapReady: () => "Here is your exchange on Uniswap. What you get comes back to your own safe. Please check it, then confirm with Face ID or decline.",
    ethPayment: () => "I can send bitcoin or USDC to your contacts. ETH stays in your safe for Aave.",
    swapOnly: () => "On Uniswap, I can exchange USDC for ETH, and ETH for USDC.",
    earnHowMuch: (withdraw) => (withdraw ? "How much ETH should I take back from Aave? You can also say “everything”." : "How much ETH should I deposit in Aave? You can also say “all my ETH”."),
    earnUnit: () => "Is that amount in ETH or in francs?",
    earnReady: (withdraw) =>
      withdraw ? "Here is your withdrawal from Aave, back into your safe. Please check it, then confirm with Face ID or decline." : "Here is your deposit in Aave: it earns interest and stays yours. Please check it, then confirm with Face ID or decline.",
    earnOnlyEth: () => "In this wallet, Aave earns interest on ETH. To start, I can exchange some USDC for ETH: say “Exchange 5 USDC for ETH”.",
    trustWhich: (names) => `Which app do you want to approve: ${names}?`,
    trustNotLive: (name) => `${name} cannot be used from Swissquote Wallet yet, so it cannot be approved.`,
    trustReady: (name) =>
      `Approving ${name} lets you use it with Face ID alone, within a daily limit. Like a new contact, it takes effect after a waiting period, and you are alerted. Approve it with Face ID?`,
    trustButton: (name) => `Approve ${name} with Face ID`,
    trustRequested: (name) => `Requested. ${name} works with Face ID alone after the waiting period. You are alerted, and you can cancel it in Rules.`,
    trustAlready: (name) => `${name} is already approved: Face ID is enough, within a daily limit.`,
    newContactButton: (name) => `Add ${name}’s address`,
    newContactWho: () => "What is the name of the person you want to add?",
    newContactKnown: (name) => `${name} is already one of your contacts.`,
    newContactReady: (name, addressSaid) =>
      `${addressSaid ? "For your safety, I never take an address from the chat. " : ""}Let’s add ${name}. On the next screen, enter their address: Swissquote checks it before anything else, and ${name} becomes a contact after a waiting period.`,
    or: "or",
  },
  fr: {
    who: (names) => `À qui dois-je l’envoyer ? Vos contacts : ${names}.`,
    unknown: (said, names) => `Vous n’avez pas de contact nommé « ${said} ». Vos contacts : ${names}. De qui parlez-vous ?`,
    which: (relation, names) => (relation ? `Quel${relation === "Son" ? "" : "le"} ${relation === "Son" ? "fils" : "fille"} : ${names} ?` : `Lequel : ${names} ?`),
    howMuch: (name) => `Combien ${name} doit-il recevoir ?`,
    digits: () => "Merci d’écrire le montant en chiffres, pour que je sois sûr : combien ?",
    asset: (name) => `Dois-je l’envoyer à ${name} en bitcoins ou en USDC ?`,
    cannotReceive: (name, asset) => `${name} ne peut pas encore recevoir ${ASSET_NAMES.fr[asset]}.`,
    address: () =>
      "Je ne peux payer que les personnes enregistrées dans vos contacts. Pour payer quelqu’un de nouveau, ajoutez-le d’abord : Swissquote le vérifie pour vous.",
    ready: (name) => `Voici votre paiement à ${name}. Vérifiez-le, puis acceptez avec Face ID ou refusez.`,
    greeting: (first) =>
      `Bonjour ${first}. Je peux payer un contact, échanger des USDC et de l’ETH sur Uniswap, placer de l’ETH sur Aave, approuver une app ou ajouter un contact. Par exemple : « Envoie 20 francs à Léo » ou « Échange 5 USDC contre de l’ETH ».`,
    declined: () => "Refusé. Rien n’a été envoyé.",
    swapDirection: () => "Dois-je échanger des USDC contre de l’ETH, ou de l’ETH contre des USDC ?",
    swapHowMuch: (from) => `Combien de ${from} dois-je échanger ?`,
    swapReady: () => "Voici votre échange sur Uniswap. Ce que vous recevez revient dans votre propre coffre. Vérifiez-le, puis confirmez avec Face ID ou refusez.",
    ethPayment: () => "Je peux envoyer des bitcoins ou des USDC à vos contacts. L’ETH reste dans votre coffre pour Aave.",
    swapOnly: () => "Sur Uniswap, je peux échanger des USDC contre de l’ETH, et de l’ETH contre des USDC.",
    earnHowMuch: (withdraw) => (withdraw ? "Combien d’ETH dois-je retirer d’Aave ? Vous pouvez aussi dire « tout »." : "Combien d’ETH dois-je déposer sur Aave ? Vous pouvez aussi dire « tout mon ETH »."),
    earnUnit: () => "Ce montant est-il en ETH ou en francs ?",
    earnReady: (withdraw) =>
      withdraw ? "Voici votre retrait d’Aave, vers votre coffre. Vérifiez-le, puis confirmez avec Face ID ou refusez." : "Voici votre dépôt sur Aave : il rapporte des intérêts et reste à vous. Vérifiez-le, puis confirmez avec Face ID ou refusez.",
    earnOnlyEth: () => "Dans ce wallet, Aave rapporte des intérêts sur l’ETH. Pour commencer, je peux échanger des USDC contre de l’ETH : dites « Échange 5 USDC contre de l’ETH ».",
    trustWhich: (names) => `Quelle app voulez-vous approuver : ${names} ?`,
    trustNotLive: (name) => `${name} n’est pas encore utilisable depuis Swissquote Wallet, elle ne peut donc pas être approuvée.`,
    trustReady: (name) =>
      `Approuver ${name} vous permet de l’utiliser avec Face ID seul, dans une limite journalière. Comme pour un nouveau contact, cela prend effet après un délai d’attente, et vous êtes alerté. L’approuver avec Face ID ?`,
    trustButton: (name) => `Approuver ${name} avec Face ID`,
    trustRequested: (name) => `Demandé. ${name} fonctionnera avec Face ID seul après le délai d’attente. Vous êtes alerté et pouvez annuler dans Règles.`,
    trustAlready: (name) => `${name} est déjà approuvée : Face ID suffit, dans une limite journalière.`,
    newContactButton: (name) => `Ajouter l’adresse de ${name}`,
    newContactWho: () => "Quel est le nom de la personne à ajouter ?",
    newContactKnown: (name) => `${name} fait déjà partie de vos contacts.`,
    newContactReady: (name, addressSaid) =>
      `${addressSaid ? "Pour votre sécurité, je ne prends jamais d’adresse dans la conversation. " : ""}Ajoutons ${name}. À l’écran suivant, saisissez son adresse : Swissquote la vérifie d’abord, et ${name} devient un contact après un délai d’attente.`,
    or: "ou",
  },
  de: {
    who: (names) => `Wer soll es erhalten? Ihre Kontakte: ${names}.`,
    unknown: (said, names) => `Sie haben keinen Kontakt namens «${said}». Ihre Kontakte: ${names}. Wen meinen Sie?`,
    which: (relation, names) => (relation ? `Welche${relation === "Son" ? "r Sohn" : " Tochter"}: ${names}?` : `Welche Person: ${names}?`),
    howMuch: (name) => `Wie viel soll ${name} erhalten?`,
    digits: () => "Bitte schreiben Sie den Betrag in Ziffern, damit ich sicher bin: wie viel?",
    asset: (name) => `Soll ich es ${name} in Bitcoin oder in USDC senden?`,
    cannotReceive: (name, asset) => `${name} kann noch keine ${ASSET_NAMES.de[asset]} empfangen.`,
    address: () =>
      "Ich kann nur Personen aus Ihren Kontakten bezahlen. Um jemand Neues zu bezahlen, fügen Sie die Person zuerst hinzu: Swissquote prüft sie für Sie.",
    ready: (name) => `Hier ist Ihre Zahlung an ${name}. Bitte prüfen Sie sie und bestätigen Sie mit Face ID oder lehnen Sie ab.`,
    greeting: (first) =>
      `Grüezi ${first}. Ich kann einen Kontakt bezahlen, USDC und ETH auf Uniswap tauschen, auf Aave Zinsen verdienen, eine App freigeben oder einen Kontakt hinzufügen. Zum Beispiel: «Schick Léo 20 Franken» oder «Tausche 5 USDC in ETH».`,
    declined: () => "Abgelehnt. Es wurde nichts gesendet.",
    swapDirection: () => "Soll ich USDC in ETH tauschen oder ETH in USDC?",
    swapHowMuch: (from) => `Wie viel ${from} soll ich tauschen?`,
    swapReady: () => "Hier ist Ihr Tausch auf Uniswap. Was Sie erhalten, kommt in Ihren eigenen Tresor. Bitte prüfen Sie ihn und bestätigen Sie mit Face ID oder lehnen Sie ab.",
    ethPayment: () => "Ich kann Ihren Kontakten Bitcoin oder USDC senden. ETH bleibt für Aave in Ihrem Tresor.",
    swapOnly: () => "Auf Uniswap kann ich USDC in ETH tauschen und ETH in USDC.",
    earnHowMuch: (withdraw) => (withdraw ? "Wie viel ETH soll ich von Aave zurückholen? Sie können auch «alles» sagen." : "Wie viel ETH soll ich auf Aave einzahlen? Sie können auch «mein ganzes ETH» sagen."),
    earnUnit: () => "Ist dieser Betrag in ETH oder in Franken?",
    earnReady: (withdraw) =>
      withdraw ? "Hier ist Ihre Auszahlung von Aave, zurück in Ihren Tresor. Bitte prüfen und mit Face ID bestätigen oder ablehnen." : "Hier ist Ihre Einzahlung auf Aave: Sie bringt Zinsen und bleibt Ihnen. Bitte prüfen und mit Face ID bestätigen oder ablehnen.",
    earnOnlyEth: () => "In dieser Wallet bringt Aave Zinsen auf ETH. Zuerst kann ich USDC in ETH tauschen: sagen Sie «Tausche 5 USDC in ETH».",
    trustWhich: (names) => `Welche App möchten Sie freigeben: ${names}?`,
    trustNotLive: (name) => `${name} kann in Swissquote Wallet noch nicht genutzt werden und kann deshalb nicht freigegeben werden.`,
    trustReady: (name) =>
      `Mit der Freigabe von ${name} genügt Face ID, innerhalb eines Tageslimits. Wie bei einem neuen Kontakt gilt sie nach einer Wartezeit, und Sie werden benachrichtigt. Mit Face ID freigeben?`,
    trustButton: (name) => `${name} mit Face ID freigeben`,
    trustRequested: (name) => `Beantragt. ${name} funktioniert nach der Wartezeit mit Face ID allein. Sie werden benachrichtigt und können es unter Regeln abbrechen.`,
    trustAlready: (name) => `${name} ist bereits freigegeben: Face ID genügt, innerhalb eines Tageslimits.`,
    newContactButton: (name) => `Adresse von ${name} hinzufügen`,
    newContactWho: () => "Wie heisst die Person, die Sie hinzufügen möchten?",
    newContactKnown: (name) => `${name} ist bereits einer Ihrer Kontakte.`,
    newContactReady: (name, addressSaid) =>
      `${addressSaid ? "Zu Ihrer Sicherheit übernehme ich nie eine Adresse aus dem Chat. " : ""}Fügen wir ${name} hinzu. Geben Sie im nächsten Schritt die Adresse ein: Swissquote prüft sie zuerst, und ${name} wird nach einer Wartezeit zum Kontakt.`,
    or: "oder",
  },
  it: {
    who: (names) => `A chi devo inviarlo? I suoi contatti: ${names}.`,
    unknown: (said, names) => `Non ha un contatto chiamato «${said}». I suoi contatti: ${names}. Chi intende?`,
    which: (relation, names) => (relation ? `Quale ${relation === "Son" ? "figlio" : "figlia"}: ${names}?` : `Quale: ${names}?`),
    howMuch: (name) => `Quanto deve ricevere ${name}?`,
    digits: () => "Per favore scriva l’importo in cifre, così sono sicuro: quanto?",
    asset: (name) => `Devo inviarlo a ${name} in bitcoin o in USDC?`,
    cannotReceive: (name, asset) => `${name} non può ancora ricevere ${ASSET_NAMES.it[asset]}.`,
    address: () =>
      "Posso pagare solo le persone salvate nei suoi contatti. Per pagare qualcuno di nuovo, lo aggiunga prima: Swissquote lo verifica per lei.",
    ready: (name) => `Ecco il suo pagamento a ${name}. Lo controlli, poi accetti con Face ID o rifiuti.`,
    greeting: (first) =>
      `Buongiorno ${first}. Posso pagare un contatto, cambiare USDC ed ETH su Uniswap, far fruttare ETH su Aave, approvare un’app o aggiungere un contatto. Per esempio: «Manda 20 franchi a Léo» o «Cambia 5 USDC in ETH».`,
    declined: () => "Rifiutato. Non è stato inviato nulla.",
    swapDirection: () => "Devo cambiare USDC in ETH, o ETH in USDC?",
    swapHowMuch: (from) => `Quanti ${from} devo cambiare?`,
    swapReady: () => "Ecco il suo cambio su Uniswap. Ciò che riceve torna nella sua cassaforte. Lo controlli, poi confermi con Face ID o rifiuti.",
    ethPayment: () => "Posso inviare bitcoin o USDC ai suoi contatti. Gli ETH restano nella sua cassaforte per Aave.",
    swapOnly: () => "Su Uniswap posso cambiare USDC in ETH, ed ETH in USDC.",
    earnHowMuch: (withdraw) => (withdraw ? "Quanti ETH devo ritirare da Aave? Può anche dire «tutto»." : "Quanti ETH devo depositare su Aave? Può anche dire «tutti i miei ETH»."),
    earnUnit: () => "Questo importo è in ETH o in franchi?",
    earnReady: (withdraw) =>
      withdraw ? "Ecco il suo prelievo da Aave, verso la sua cassaforte. Lo controlli, poi confermi con Face ID o rifiuti." : "Ecco il suo deposito su Aave: frutta interessi e resta suo. Lo controlli, poi confermi con Face ID o rifiuti.",
    earnOnlyEth: () => "In questo wallet, Aave fa fruttare ETH. Per iniziare posso cambiare USDC in ETH: dica «Cambia 5 USDC in ETH».",
    trustWhich: (names) => `Quale app vuole approvare: ${names}?`,
    trustNotLive: (name) => `${name} non è ancora utilizzabile da Swissquote Wallet, quindi non può essere approvata.`,
    trustReady: (name) =>
      `Approvando ${name} basta Face ID, entro un limite giornaliero. Come per un nuovo contatto, vale dopo un periodo di attesa e lei viene avvisato. Approvarla con Face ID?`,
    trustButton: (name) => `Approva ${name} con Face ID`,
    trustRequested: (name) => `Richiesto. ${name} funzionerà con Face ID da solo dopo il periodo di attesa. Lei viene avvisato e può annullare in Regole.`,
    trustAlready: (name) => `${name} è già approvata: basta Face ID, entro un limite giornaliero.`,
    newContactButton: (name) => `Aggiungi l’indirizzo di ${name}`,
    newContactWho: () => "Come si chiama la persona da aggiungere?",
    newContactKnown: (name) => `${name} è già uno dei suoi contatti.`,
    newContactReady: (name, addressSaid) =>
      `${addressSaid ? "Per la sua sicurezza, non prendo mai un indirizzo dalla chat. " : ""}Aggiungiamo ${name}. Nella schermata successiva inserisca il suo indirizzo: Swissquote lo verifica prima di tutto, e ${name} diventa un contatto dopo un periodo di attesa.`,
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
  ETH: ["eth", "ether", "ethereum"],
};
/** "All my ETH", "everything", "tout", "alles", "tutto". */
const ALL_WORDS = ["all", "everything", "tout", "toute", "tous", "alles", "gesamte", "ganzes", "tutto", "tutti"];
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
  switch (draft.intent) {
    case "swap":
      return resolveSwap(draft, said.join("\n"), MESSAGES[language]);
    case "earn":
    case "withdraw":
      return resolveEarn(draft, said.join("\n"), MESSAGES[language]);
    case "trustApp":
      return resolveTrustApp(draft, said.join("\n"), MESSAGES[language]);
    case "addContact":
      return resolveNewContact(draft, said, contacts, MESSAGES[language]);
    default:
      return resolvePayment(draft, said, contacts, language);
  }
}

function resolvePayment(draft: PaymentDraft, said: string[], contacts: Contact[], language: AssistantLanguage): Resolution {
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
  if (currency === "ETH") return { kind: "refuse", reason: m.ethPayment() };

  // Asset: the unit decides, then the client's words, then what the contact can receive.
  const receivable: DraftAsset[] = [...(contact.btcAddress ? ["BTC" as const] : []), ...(contact.ethAddress ? ["USDC" as const] : [])];
  const asset: DraftAsset | null = currency !== "CHF" ? currency : (assetIn(text) ?? draft.asset ?? (receivable.length === 1 ? receivable[0] : null));
  if (!asset) return { kind: "ask", draft: { ...named, currency }, question: m.asset(contact.name) };
  if (!receivable.includes(asset)) return { kind: "refuse", reason: m.cannotReceive(contact.name, asset) };

  const fromSavings = asset === "BTC" && mentions(text, SAVINGS_WORDS);
  return { kind: "ready", contact, amount: draft.amount, currency, asset, fromSavings, message: m.ready(contact.name) };
}

// ---------------------------------------------------------------- exchanges, Aave, apps, new contacts

/** The amount the client wrote, or null: the model's number counts only if it appears in the client's words. */
const amountSaid = (draft: PaymentDraft, text: string) =>
  draft.amount !== null && numbersIn(text).some((n) => Math.abs(n - draft.amount!) < 1e-9) ? draft.amount : null;

/** "USDC for ETH" gives USDC: the first of the two tokens the client wrote. */
function firstToken(text: string): SwapToken | null {
  const tokens = words(text);
  const at = (unit: SwapToken) => tokens.findIndex((w) => UNIT_WORDS[unit].includes(w));
  const [usdc, eth] = [at("USDC"), at("ETH")];
  if (usdc < 0 && eth < 0) return null;
  return eth < 0 || (usdc >= 0 && usdc < eth) ? "USDC" : "ETH";
}

function resolveSwap(draft: PaymentDraft, text: string, m: Messages): Resolution {
  if (mentions(text, UNIT_WORDS.BTC)) return { kind: "refuse", reason: m.swapOnly() };
  const amount = amountSaid(draft, text);
  const unit = amount !== null ? unitNextTo(text, amount) : null;
  if (unit === "BTC") return { kind: "refuse", reason: m.swapOnly() };
  const unitToken = unit === "USDC" || unit === "ETH" ? unit : null;
  // "Buy 0.001 ETH": the amount is what the client wants to receive. Uniswap here takes the amount given, so ask for it.
  if (unitToken && draft.from && draft.from !== unitToken && mentions(text, UNIT_WORDS[draft.from])) {
    return { kind: "ask", draft: { ...draft, amount: null }, question: m.swapHowMuch(draft.from) };
  }
  // The unit next to the amount names the token given; then the model's reading, if the client wrote that token; then word order.
  const from = unitToken ?? (draft.from && mentions(text, UNIT_WORDS[draft.from]) ? draft.from : firstToken(text));
  if (!from) return { kind: "ask", draft: { ...draft, amount }, question: m.swapDirection() };
  if (amount === null) return { kind: "ask", draft: { ...draft, from, amount: null }, question: draft.amount === null ? m.swapHowMuch(from) : m.digits() };
  return { kind: "swap", from, amount, currency: unit === "CHF" ? "CHF" : from, message: m.swapReady() };
}

function resolveEarn(draft: PaymentDraft, text: string, m: Messages): Resolution {
  const withdraw = draft.intent === "withdraw";
  const action = withdraw ? "withdraw" : "supply";
  const amount = amountSaid(draft, text);
  if (amount === null && mentions(text, ALL_WORDS)) return { kind: "earn", action, amount: "all", currency: "ETH", message: m.earnReady(withdraw) };
  if (amount === null) return { kind: "ask", draft: { ...draft, amount: null }, question: draft.amount === null ? m.earnHowMuch(withdraw) : m.digits() };
  const unit = unitNextTo(text, amount) ?? (mentions(text, UNIT_WORDS.ETH) ? "ETH" : null);
  if (unit === "USDC" || unit === "BTC") return { kind: "refuse", reason: m.earnOnlyEth() };
  if (!unit) return { kind: "ask", draft: { ...draft, amount }, question: m.earnUnit() };
  return { kind: "earn", action, amount, currency: unit === "CHF" ? "CHF" : "ETH", message: m.earnReady(withdraw) };
}

function resolveTrustApp(draft: PaymentDraft, text: string, m: Messages): Resolution {
  // Only an app the client named, from Swissquote's list: the model cannot introduce one.
  const said = normalize(text);
  const app = APPS.find((a) => said.includes(normalize(a.name)));
  const live = APPS.filter((a) => a.live);
  if (!app) return { kind: "ask", draft, question: m.trustWhich(list(live.map((a) => a.name), m.or)) };
  if (!app.live) return { kind: "refuse", reason: m.trustNotLive(app.name) };
  return { kind: "trustApp", appId: app.id, appName: app.name, message: m.trustReady(app.name) };
}

/** A new contact's name, as the client wrote it: letters, spaces, apostrophes and hyphens only. */
const PERSON_NAME = /^[\p{L}][\p{L}' -]{0,39}$/u;

function resolveNewContact(draft: PaymentDraft, said: string[], contacts: Contact[], m: Messages): Resolution {
  const text = said.join("\n");
  const name = draft.recipient?.trim() ?? "";
  // The name must be one the client wrote; an address is never taken, whatever the model returned.
  const valid = PERSON_NAME.test(name) && !containsAddress(name) && words(name).every((part) => words(text).includes(part));
  if (!valid) return { kind: "ask", draft: { ...draft, recipient: null }, question: m.newContactWho() };
  const known = contacts.find((c) => normalize(c.name) === normalize(name));
  if (known) return { kind: "refuse", reason: m.newContactKnown(known.name) };
  return { kind: "addContact", name, message: m.newContactReady(name, said.some(containsAddress)) };
}

/**
 * The client's answer to a question fills in what was missing, without asking the model again:
 * a contact's name, an amount, a unit, the direction of an exchange, an app.
 */
export function mergeAnswer(draft: PaymentDraft, answer: string, contacts: Contact[]): PaymentDraft {
  const named = namedIn(answer, contacts);
  const amount = numbersIn(answer)[0];
  const unit = amount !== undefined ? unitNextTo(answer, amount) : null;
  const newName = draft.intent === "addContact" && !draft.recipient && PERSON_NAME.test(answer.trim()) ? answer.trim() : null;
  return {
    intent: draft.intent,
    recipient: newName ?? (named.length === 1 ? named[0].name : (draft.recipient ?? (relationOf(answer) ? answer : null))),
    amount: draft.amount ?? amount ?? null,
    currency: unit ?? (mentions(answer, UNIT_WORDS.ETH) ? "ETH" : mentions(answer, UNIT_WORDS.CHF) ? "CHF" : draft.currency),
    asset: assetIn(answer) ?? draft.asset,
    pocket: draft.pocket,
    app: draft.app,
    from: draft.from ?? firstToken(answer),
  };
}

/** Checks the model's JSON field by field; anything unexpected becomes null. */
export function sanitizeDraft(value: unknown): PaymentDraft {
  const v = (value ?? {}) as Record<string, unknown>;
  const oneOf = <T extends string>(x: unknown, options: readonly T[]): T | null => (options.includes(x as T) ? (x as T) : null);
  const amount = typeof v.amount === "number" ? v.amount : typeof v.amount === "string" ? Number(v.amount.replace(",", ".")) : NaN;
  return {
    intent: oneOf(v.intent, ASSISTANT_INTENTS) ?? "pay",
    recipient: typeof v.recipient === "string" && v.recipient.trim() ? v.recipient.trim().slice(0, 80) : null,
    amount: Number.isFinite(amount) && amount > 0 ? amount : null,
    currency: oneOf(v.currency, ["CHF", "USDC", "BTC", "ETH"] as const),
    asset: oneOf(v.asset, ["BTC", "USDC"] as const),
    pocket: oneOf(v.pocket, ["spending", "savings"] as const),
    app: typeof v.app === "string" && v.app.trim() ? v.app.trim().slice(0, 40) : null,
    from: oneOf(v.from, ["USDC", "ETH"] as const),
  };
}
