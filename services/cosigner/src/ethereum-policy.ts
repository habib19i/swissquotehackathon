/**
 * What Swissquote agrees to co-sign with the MPC key on Base (CLAUDE.md sections 6, 7 and 9).
 * Swissquote decodes the operation and recomputes its hash and CHF value itself; nothing is taken
 * from the app. Daily payments are not here: the passkey signs them alone.
 */
import { hexToBytes, isAddressEqual, type Address, type Hex } from "viem";
import {
  UnsupportedCallError,
  chfForUsdc,
  decodeActions,
  deployment,
  limitMatches,
  userOpHash,
  type AccountAction,
  type AccountSettings,
  type RulesTarget,
  type UserOp,
} from "@sqw/ethereum";
import type { Rulebook, ShieldResult } from "@sqw/shared";
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
  /** Swissquote's address: Standard-plan fees are paid to it. */
  swissquote: Address;
}

export interface EthReview {
  actions: AccountAction[];
  /** The one person paid, if any. */
  payment?: { to: Address; amount: bigint };
  /** USDC paid to Swissquote for the network fee. */
  fee: bigint;
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
      case "payContact":
        throw new PolicyError("Daily payments are confirmed with Face ID alone; Swissquote does not sign them.");
    }
  }
  if (fee > MAX_FEE_USDC) throw new PolicyError("This network fee is too high.");

  const shield = payment
    ? screenPayment({ address: payment.to, valueChf: chfForUsdc(payment.amount, ctx.usdcChf), rulebook: ctx.rulebook })
    : undefined;
  return { actions, payment, fee, shield };
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
