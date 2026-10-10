/**
 * The client's rulebook on-chain (CLAUDE.md section 6). Swissquote's service applies changes after
 * their waiting period; the account then gets the new rules in one operation signed with the MPC key.
 */
import { contactsRoot, type EthStatus, type Rulebook } from "@sqw/shared";
import type { Hex } from "viem";
import type { OnChainRules } from "./account";
import type { SelfAction } from "./calls";
import { usdcForChf } from "./usdc";

export interface RulesTarget {
  contactsRoot: Hex;
  /** USDC units. */
  dailyLimit: bigint;
  frozen: boolean;
}

/** What the account's on-chain rules should be for a rulebook, at today's USDC/CHF rate. */
export function rulesTarget(rulebook: Rulebook, usdcChf: number): RulesTarget {
  return {
    contactsRoot: contactsRoot(rulebook.contacts),
    dailyLimit: usdcForChf(rulebook.dailyLimitChf, usdcChf),
    frozen: rulebook.frozen,
  };
}

/** The limit is set in USDC at the rate of the day: a small drift of the rate is not a change of rules. */
export const LIMIT_TOLERANCE = 0.02;

export function limitMatches(onChain: bigint, target: bigint): boolean {
  const diff = onChain > target ? onChain - target : target - onChain;
  return Number(diff) <= Number(target) * LIMIT_TOLERANCE;
}

/** The account calls that bring the on-chain rules to the target; empty when they already match. */
export function syncActions(onChain: OnChainRules, target: RulesTarget): SelfAction[] {
  const actions: SelfAction[] = [];
  if (onChain.contactsRoot !== target.contactsRoot || !limitMatches(onChain.dailyLimit, target.dailyLimit)) {
    actions.push({ kind: "setRulebook", root: target.contactsRoot, limit: target.dailyLimit });
  }
  if (onChain.frozen !== target.frozen) actions.push({ kind: "setFrozen", frozen: target.frozen });
  return actions;
}

/** The account calls still needed, from Swissquote's status of the account (JSON form). */
export function pendingSync(status: EthStatus): SelfAction[] {
  const onChain: OnChainRules = {
    ...status.onChain,
    deployed: status.deployed,
    dailyLimit: BigInt(status.onChain.dailyLimit),
    remainingToday: BigInt(status.onChain.remainingToday),
  };
  return syncActions(onChain, { ...status.target, dailyLimit: BigInt(status.target.dailyLimit) });
}
