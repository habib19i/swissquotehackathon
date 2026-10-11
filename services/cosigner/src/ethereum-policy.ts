/**
 * What Swissquote agrees to co-sign with the MPC key on Base (CLAUDE.md sections 6, 7 and 9).
 * Swissquote decodes the operation and recomputes its hash and CHF value itself; nothing is taken
 * from the app. Daily payments and approved apps are not here: the passkey signs them alone.
 */
import { hexToBytes, isAddressEqual, maxUint256, type Address, type Hex } from "viem";
import {
  PROTOCOLS,
  UnsupportedCallError,
  USDC,
  appOfAdapter,
  chfForUsdc,
  decodeActions,
  decodeAppParams,
  formatEth,
  formatUsdc,
  deployment,
  limitMatches,
  userOpHash,
  type AccountAction,
  type AccountSettings,
  type RulesTarget,
  type UserOp,
} from "@sqw/ethereum";
import { appById, type Rulebook, type ShieldResult } from "@sqw/shared";
import { PolicyError } from "./bitcoin-policy";
import { screenPayment } from "./shield";

/** The most Swissquote takes as a network fee in one operation (Standard plan). */
export const MAX_FEE_USDC = 1_000_000n;

export interface EthPolicyContext {
  account: Address;
  /** What the account is created with: an operation that deploys it must use exactly these. */
  settings: AccountSettings;
  /** The passkey the account should accept now (replaced by a recovery). */
  passkey: { x: Hex; y: Hex };
  rulebook: Rulebook;
  /** The rules in force, in their on-chain form. */
  target: RulesTarget;
  usdcChf: number;
  ethChf: number;
  /** Swissquote's address: Standard-plan fees are paid to it. */
  swissquote: Address;
}

export interface EthReview {
  actions: AccountAction[];
  /** The one person paid, if any. */
  payment?: { to: Address; amount: bigint };
  /** USDC paid to Swissquote for the network fee. */
  fee: bigint;
  /** A DeFi app used in this operation, if any. */
  appUse?: { app: string; params: Hex };
  /** What a connected app (WalletConnect) asked for, in plain words. */
  dappRequest?: string;
  shield?: ShieldResult;
}

const sameHex = (a: Hex, b: Hex) => a.toLowerCase() === b.toLowerCase();

export function reviewEthOp(op: UserOp, ctx: EthPolicyContext): EthReview {
  if (!isAddressEqual(op.sender, ctx.account)) throw new PolicyError("This operation is not for your safe.");
  if (op.factory) {
    const expected = deployment(ctx.settings);
    if (!isAddressEqual(op.factory, expected.factory) || op.factoryData !== expected.factoryData) {
      throw new PolicyError("This operation would create a different account.");
    }
  }

  let actions: AccountAction[];
  try {
    actions = decodeActions(ctx.account, op.callData);
  } catch (err) {
    if (err instanceof UnsupportedCallError) throw new PolicyError(err.message);
    throw err;
  }

  let payment: EthReview["payment"];
  let appUse: EthReview["appUse"];
  let dappRequest: string | undefined;
  const oneRequest = (what: string) => {
    if (appUse || payment || dappRequest) throw new PolicyError("Swissquote co-signs one payment or app request at a time.");
    dappRequest = what;
  };
  const amountOf = (asset: Address, amount: bigint) =>
    amount === maxUint256 ? "everything" : isAddressEqual(asset, USDC.address) ? formatUsdc(amount) : formatEth(amount);
  let fee = 0n;
  for (const action of actions) {
    switch (action.kind) {
      case "usdcTransfer":
        if (isAddressEqual(action.to, ctx.swissquote)) {
          fee += action.amount;
        } else if (payment) {
          throw new PolicyError("Swissquote co-signs one payment at a time.");
        } else {
          payment = { to: action.to, amount: action.amount };
        }
        break;
      case "setRulebook":
        if (!sameHex(action.root, ctx.target.contactsRoot) || !limitMatches(action.limit, ctx.target.dailyLimit)) {
          throw new PolicyError("These are not the rules in force. A change still in its waiting period cannot be written yet.");
        }
        break;
      case "setFrozen":
        if (action.frozen !== ctx.target.frozen) throw new PolicyError("These are not the rules in force.");
        break;
      case "setPasskey":
        if (!sameHex(action.x, ctx.passkey.x) || !sameHex(action.y, ctx.passkey.y)) {
          throw new PolicyError("Only the Face ID of the phone that recovered this safe can be added.");
        }
        break;
      case "revokeContact":
        break; // removing a contact only tightens the rules
      case "setApp":
        if (action.approved !== ctx.target.apps.some((a) => isAddressEqual(a, action.app))) {
          throw new PolicyError("These are not the rules in force. A new app becomes approved after its waiting period.");
        }
        break;
      case "setAppLimit":
        if (!limitMatches(action.limit, ctx.target.appLimit)) throw new PolicyError("These are not the rules in force.");
        break;
      case "useApp": {
        const app = appOfAdapter(action.app);
        if (!app) throw new PolicyError("Swissquote has not vetted this app.");
        if (appUse || payment) throw new PolicyError("Swissquote co-signs one payment or app at a time.");
        appUse = { app, params: action.params };
        break;
      }
      case "tokenApproval":
        // Only a vetted protocol may take tokens from the safe, and only for what the client then does with it.
        if (!isAddressEqual(action.spender, PROTOCOLS.aave.pool)) throw new PolicyError("Swissquote only lets apps it has vetted use your tokens.");
        oneRequest(`You allow Aave to take up to ${amountOf(action.token, action.amount)} from your safe, for the deposit that follows.`);
        break;
      case "aaveSupply":
        if (!isAddressEqual(action.onBehalfOf, ctx.account)) throw new PolicyError("This deposit would be credited to someone else. Swissquote stopped it.");
        oneRequest(`You deposit ${amountOf(action.asset, action.amount)} in Aave to earn interest. It is credited to your own safe.`);
        break;
      case "aaveWithdraw":
        if (!isAddressEqual(action.to, ctx.account)) throw new PolicyError("This withdrawal would go to someone else. Swissquote stopped it.");
        oneRequest(`You take ${amountOf(action.asset, action.amount)} back from Aave, into your own safe.`);
        break;
      case "payContact":
        throw new PolicyError("Daily payments are confirmed with Face ID alone; Swissquote does not sign them.");
    }
  }
  if (fee > MAX_FEE_USDC) throw new PolicyError("This network fee is too high.");

  const shield = payment
    ? screenPayment({ address: payment.to, valueChf: chfForUsdc(payment.amount, ctx.usdcChf), rulebook: ctx.rulebook })
    : appUse
      ? screenAppUse(appUse.app, appUse.params, ctx)
      : dappRequest
        ? screenDappRequest(dappRequest, ctx)
        : undefined;
  return { actions, payment, fee, appUse, dappRequest, shield };
}

/**
 * Swissquote's check of an app used outside the client's approved apps: what it does, in plain words.
 * Whatever comes out goes back to the client's own safe (the adapter fixes it), so the risk is the trade
 * itself, not a stranger receiving the money.
 */
function screenAppUse(appId: string, params: Hex, ctx: EthPolicyContext): ShieldResult {
  const app = appById(appId);
  const request = decodeAppParams(appId as "uniswap" | "aave", params);
  const isUsdc = request.app === "uniswap" && isAddressEqual(request.tokenIn, USDC.address);
  const what =
    request.app === "uniswap"
      ? isUsdc
        ? `You exchange ${formatUsdc(request.amountIn)} for at least ${formatEth(request.minOut)} on Uniswap.`
        : `You exchange ${formatEth(request.amountIn)} for at least ${formatUsdc(request.minOut)} on Uniswap.`
      : request.action === "supply"
        ? `You deposit ${formatEth(request.amount)} in Aave to earn interest.`
        : "You take your ETH back from Aave.";
  const valueChf =
    request.app === "uniswap"
      ? isUsdc
        ? chfForUsdc(request.amountIn, ctx.usdcChf)
        : (Number(request.amountIn) / 1e18) * ctx.ethChf
      : request.action === "supply"
        ? (Number(request.amount) / 1e18) * ctx.ethChf
        : 0;
  if (ctx.rulebook.frozen) return { verdict: "BLOCKED", reasons: ["Your safe is frozen. Unfreeze it before using apps."], valueChf };
  const approved = (ctx.rulebook.apps ?? []).includes(appId);
  return {
    verdict: approved ? "APPROVE" : "NEEDS_CONFIRMATION",
    reasons: [
      what,
      "It comes back to your own safe.",
      ...(approved ? [] : [`${app?.name ?? "This app"} is not one of your approved apps, so Swissquote checked this operation for you.`]),
    ],
    valueChf,
  };
}

/** A connected app's request: always the client's explicit confirmation, never Face ID alone. */
function screenDappRequest(what: string, ctx: EthPolicyContext): ShieldResult {
  if (ctx.rulebook.frozen) return { verdict: "BLOCKED", reasons: ["Your safe is frozen. Unfreeze it before using apps."], valueChf: 0 };
  return { verdict: "NEEDS_CONFIRMATION", reasons: [what, "A connected app asked for this. Swissquote checked that it only uses Aave, for your own safe."], valueChf: 0 };
}

/** Swissquote's checks before its MPC share signs; returns the digest it computed itself. */
export function authorizeEthOp(op: UserOp, ctx: EthPolicyContext, clientConfirmed = false): Uint8Array {
  const { shield } = reviewEthOp(op, ctx);
  if (shield?.verdict === "BLOCKED") throw new PolicyError(shield.reasons.join(" "));
  if (shield?.verdict === "NEEDS_CONFIRMATION" && !clientConfirmed) {
    throw new PolicyError(`Swissquote needs your confirmation first. ${shield.reasons.join(" ")}`);
  }
  return hexToBytes(userOpHash(op));
}
