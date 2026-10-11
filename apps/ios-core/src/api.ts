/**
 * What the iOS app can ask the wallet core, by name. Each method is the web app's own wallet function
 * (apps/web/lib), so both apps behave the same; the iOS screens call these instead of the web pages.
 *
 * Conventions:
 * - Arguments and results are JSON: amounts (satoshis, USDC units, wei) as decimal strings.
 * - The current safe is read from storage, as the web pages do with `RequireWallet`; methods that need it
 *   fail plainly when this phone has no safe.
 * - A prepared payment or operation stays in the core: the result carries a `handle`, and the matching
 *   send method takes it back. Swift never rebuilds a transaction.
 */
import type { Address, Hex } from "viem";
import { PROTOCOLS, USDC, aaveEthRate, minimumOut, quoteSwap, type AppRequest } from "@sqw/ethereum";
import type { DklsKeyshare } from "@sqw/mpc";
import {
  mergeAnswer,
  resolveDraft,
  type AssistantLanguage,
  type Contact,
  type FaceCheckAttestation,
  type PaymentDraft,
  type Plan,
  type RecoveryKeyKind,
  type Resolution,
  type RulebookChange,
  type WalletRecord,
} from "@sqw/shared";
import { loadActivity } from "../../web/lib/activity";
import { askPlanner, prepareAppPlan, preparePlanned } from "../../web/lib/assistant/client";
import { cosigner, swissquoteOnline } from "../../web/lib/cosigner";
import { createSafe, setUpFaceId } from "../../web/lib/create-wallet";
import { forgetThisPhone } from "../../web/lib/demo";
import { proveUsdcOwnership } from "../../web/lib/ownership";
import { loadClient, loadProfile, logout, saveClient, type Client, type WalletProfile } from "../../web/lib/profile";
import { provider } from "../../web/lib/provider";
import { beginRecovery, completeRecovery, faceCheck, verifyRecovery } from "../../web/lib/recover";
import { addRecoveryKey, hasRecoveryKey } from "../../web/lib/recovery-key";
import { loadRulebook, requestChange } from "../../web/lib/rules";
import { finishSetup, swissquoteRecord } from "../../web/lib/setup";
import {
  available,
  loadBalances,
  moveExcessToSavings,
  preparePayment,
  refillPocketNow,
  sendPayment,
  withShare,
  type PreparedPayment,
} from "../../web/lib/wallet-bitcoin";
import { appsAvailable, loadPositions, prepareAppUse, sendAppUse, type AppUse } from "../../web/lib/wallet-defi";
import { loadUsdcBalance, prepareUsdcPayment, sendUsdcPayment, updateRulesOnBase, usdcAccount, baseReader, type UsdcPayment } from "../../web/lib/wallet-usdc";
import { prepareDappTransaction, sendDappTransaction, transactionOf } from "../../web/lib/walletconnect";
import type { EthPrepared } from "@sqw/shared";
import { assistantSetup, assistantText, assistantTurn, type TurnInput } from "./assistant";
import { emit } from "./bridge";
import type { WalletPasskey } from "./native/passkey";

// ---------------------------------------------------------------- handles

const kept = new Map<string, unknown>();
let nextHandle = 1;

function keep(value: unknown): string {
  const handle = `h${nextHandle++}`;
  kept.set(handle, value);
  return handle;
}

function take<T>(handle: unknown): T {
  const value = kept.get(String(handle));
  if (value === undefined) throw new Error("This step has expired. Please start again.");
  return value as T;
}

function release(handle: unknown) {
  const value = kept.get(String(handle));
  kept.delete(String(handle));
  // A key share in WebAssembly memory is freed as soon as it is no longer needed.
  if (value && typeof (value as DklsKeyshare).free === "function") (value as DklsKeyshare).free();
}

// ---------------------------------------------------------------- arguments

const big = (value: unknown, what: string): bigint => {
  if (typeof value !== "string" && typeof value !== "number") throw new Error(`${what} is missing.`);
  return BigInt(value);
};

async function profile(): Promise<WalletProfile> {
  const saved = await loadProfile();
  if (!saved) throw new Error("This phone does not hold a safe yet.");
  return saved;
}

/** An app request from Swift, amounts as strings. */
function appRequest(raw: Record<string, unknown>): AppRequest {
  if (raw.app === "uniswap") {
    return { app: "uniswap", tokenIn: raw.tokenIn as Address, amountIn: big(raw.amountIn, "The amount"), minOut: big(raw.minOut, "The minimum") };
  }
  if (raw.app === "aave" && (raw.action === "supply" || raw.action === "withdraw")) {
    return { app: "aave", action: raw.action, amount: big(raw.amount, "The amount") };
  }
  throw new Error("This app request is not supported.");
}

/** Prepared items go back to Swift with their handle; the item itself stays here. */
const prepared = <T>(value: T) => ({ handle: keep(value), ...(value as object) });

const progress = (event: string) => (round: number, total: number) => emit(event, { round, total });

/** A few Swissquote endpoints take amounts as bigints; the rest pass through unchanged. */
const BIGINT_ARGUMENT: Record<string, number> = { shield: 2, shieldUsdc: 2 };

function passthrough(client: Record<string, (...args: never[]) => unknown>, name: string, args: unknown[]) {
  const method = client[name];
  if (typeof method !== "function") throw new Error(`Unknown service call ${name}.`);
  const position = BIGINT_ARGUMENT[name];
  const fixed = position === undefined ? args : args.map((arg, i) => (i === position ? big(arg, "The amount") : arg));
  return (method as (...args: unknown[]) => unknown)(...fixed);
}

// ---------------------------------------------------------------- methods

type Method = (...args: never[]) => unknown;

export const methods: Record<string, Method> = {
  // Session (MOCK Swissquote login) and the safe on this phone.
  "client.load": () => loadClient(),
  "client.save": (client: Client) => saveClient(client),
  "client.logout": () => logout(),
  "profile.load": () => loadProfile(),
  forgetThisPhone: () => forgetThisPhone(),
  swissquoteOnline: () => swissquoteOnline(),
  price: async () => (await fetch("/api/price")).json(),
  constants: () => ({ usdc: USDC.address, weth: PROTOCOLS.weth }),

  // Opening a safe (onboarding).
  setUpFaceId: async (client: Client) => (await setUpFaceId(client)).passkey,
  createSafe: async (client: Client, passkey: WalletPasskey) => {
    const { profile, share } = await createSafe(client, passkey, undefined, progress("keygen-progress"));
    return { profile, share: keep(share) };
  },
  finishSetup: async (shareHandle: string, plan?: Plan) => {
    try {
      return await finishSetup(await profile(), take<DklsKeyshare>(shareHandle), plan);
    } finally {
      release(shareHandle);
    }
  },
  /** Home: "Finish setting up with Face ID", for a safe whose setup was interrupted. */
  finishSetupWithFaceId: async () => {
    const current = await profile();
    return withShare(current, (share) => finishSetup(current, share));
  },
  proveUsdcOwnership: async () => {
    const current = await profile();
    return withShare(current, (share) => proveUsdcOwnership(current, share));
  },
  swissquoteRecord: (walletId: string) => swissquoteRecord(walletId),
  addRecoveryKey: async (kind: RecoveryKeyKind) => addRecoveryKey(await profile(), kind),
  hasRecoveryKey: (walletId: string) => hasRecoveryKey(walletId),

  // Recovery on a new phone.
  beginRecovery: (walletId: string) => beginRecovery(walletId),
  faceCheck: (walletId: string, recoveryId: string, simulate: FaceCheckAttestation["result"]) => faceCheck(walletId, recoveryId, simulate),
  verifyRecovery: (recoveryId: string, requestId: string, assertion: unknown, attestation: FaceCheckAttestation) =>
    verifyRecovery(recoveryId, requestId, assertion, attestation),
  completeRecovery: (client: Client, record: WalletRecord, recoveryId: string, passkey: WalletPasskey) =>
    completeRecovery(client, record, recoveryId, passkey, undefined, progress("recovery-progress")),

  // Bitcoin: Spending pocket and Savings safe.
  loadBalances: async () => loadBalances(await profile()),
  available: async () => available(await profile()),
  preparePayment: async (contact: Contact, amountSats: string, from?: "savings") =>
    prepared(await preparePayment(await profile(), contact, big(amountSats, "The amount"), from)),
  sendPayment: async (handle: string, btcChf: number, clientConfirmed = false) => {
    const result = await sendPayment(await profile(), take<PreparedPayment>(handle), btcChf, clientConfirmed);
    release(handle);
    return result;
  },
  refillPocketNow: async (btcChf: number) => refillPocketNow(await profile(), btcChf),
  moveExcessToSavings: async (amountSats: string) => moveExcessToSavings(await profile(), big(amountSats, "The amount")),

  // USDC on Base.
  usdcAccount: async () => usdcAccount(await profile()),
  loadUsdcBalance: async () => loadUsdcBalance(await profile()),
  prepareUsdcPayment: async (contact: Contact, amount: string) =>
    prepared(await prepareUsdcPayment(await profile(), contact, big(amount, "The amount"))),
  sendUsdcPayment: async (handle: string, clientConfirmed = false) => {
    const sent = await sendUsdcPayment(await profile(), take<UsdcPayment>(handle), clientConfirmed);
    release(handle);
    return sent;
  },
  updateRulesOnBase: async () => updateRulesOnBase(await profile()),

  // Rules and activity.
  loadRulebook: (walletId: string) => loadRulebook(walletId),
  requestChange: async (change: RulebookChange) => requestChange(await profile(), change),
  loadActivity: async () => loadActivity(await profile()),

  // DeFi apps (Explore).
  loadPositions: async () => loadPositions(await profile()),
  appsAvailable: async () => appsAvailable(await profile()),
  quoteSwap: (tokenIn: Address, amountIn: string) => quoteSwap(baseReader, tokenIn, big(amountIn, "The amount")),
  minimumOut: (quote: string) => minimumOut(big(quote, "The quote")),
  aaveEthRate: () => aaveEthRate(baseReader),
  prepareAppUse: async (request: Record<string, unknown>) => prepared(await prepareAppUse(await profile(), appRequest(request))),
  sendAppUse: async (handle: string, clientConfirmed = false) => {
    const sent = await sendAppUse(await profile(), take<AppUse>(handle), clientConfirmed);
    release(handle);
    return sent;
  },

  // Assistant: the model drafts (server route), the rules decide (here), the client confirms (Swift).
  askPlanner: (text: string, contacts: Contact[]) => askPlanner(text, contacts),
  resolveDraft: (draft: PaymentDraft, said: string[], contacts: Contact[], language: AssistantLanguage) =>
    resolveDraft(draft, said, contacts, language),
  mergeAnswer: (draft: PaymentDraft, answer: string, contacts: Contact[]) => mergeAnswer(draft, answer, contacts),
  /** The chat screen: setup, fixed texts, and one turn (the web page's submit), with prepared results kept here. */
  "assistant.setup": (firstName: string, language?: AssistantLanguage) => assistantSetup(firstName, language),
  "assistant.text": (language: AssistantLanguage, key: string, args?: unknown[]) => assistantText(language, key, args),
  "assistant.turn": async (input: TurnInput) => {
    const turn = await assistantTurn(await profile(), input);
    return {
      ...turn,
      payment: turn.payment && { asset: turn.payment.asset, payment: prepared(turn.payment.payment) },
      appUse: turn.appUse && { app: turn.appUse.app, use: prepared(turn.appUse.use) },
    };
  },
  /** A resolved payment: `payment.handle` goes to sendPayment (BTC) or sendUsdcPayment (USDC). */
  preparePlanned: async (ready: Extract<Resolution, { kind: "ready" }>, prices: { btcChf: number; usdcChf: number }) => {
    const planned = await preparePlanned(await profile(), ready, prices);
    return { asset: planned.asset, payment: prepared(planned.payment) };
  },
  /** A resolved exchange or Aave request: the handle goes to sendAppUse. */
  prepareAppPlan: async (plan: Extract<Resolution, { kind: "swap" | "earn" }>, prices: { usdcChf: number; ethChf: number }) =>
    prepared(await prepareAppPlan(await profile(), plan, prices)),

  // WalletConnect requests (the session itself is handled natively with Reown's Swift SDK).
  transactionOf: (request: Parameters<typeof transactionOf>[0]) => transactionOf(request),
  prepareDappTransaction: async (tx: { to: Hex; data: Hex; value: string }) =>
    prepared(await prepareDappTransaction(await profile(), { to: tx.to, data: tx.data, value: big(tx.value, "The value") })),
  sendDappTransaction: async (handle: string) => {
    const sent = await sendDappTransaction(await profile(), take<EthPrepared>(handle));
    release(handle);
    return sent;
  },

  /** Drops a prepared item the client declined. */
  release: (handle: string) => release(handle),
};

/** `cosigner.<name>` and `provider.<name>`: the web app's service clients, for screens that call them directly. */
export function callService(name: string, args: unknown[]): unknown {
  const [service, method] = name.split(".");
  if (service === "cosigner") return passthrough(cosigner as never, method, args);
  if (service === "provider") return passthrough(provider as never, method, args);
  throw new Error(`Unknown method ${name}.`);
}
