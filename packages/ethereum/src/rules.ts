/**
 * The client's rulebook on-chain (CLAUDE.md section 6). Swissquote's service applies changes after
 * their waiting period; the account then gets the new rules in one operation signed with the MPC key.
 */
import { DEFAULT_APP_LIMIT_CHF, contactsRoot, type EthStatus, type Rulebook } from "@sqw/shared";
import { isAddressEqual, type Address, type Hex } from "viem";
import { adapterOf } from "./apps";
import { DEPLOYMENTS } from "./deployments";
import type { OnChainRules } from "./account";
import type { SelfAction } from "./calls";
import { usdcForChf } from "./usdc";

export interface RulesTarget {
  contactsRoot: Hex;
  /** USDC units. */
  dailyLimit: bigint;
  frozen: boolean;
  /** Adapters of the approved apps; empty on accounts without apps. */
  apps: Address[];
  /** USDC units the apps may take out per day. */
  appLimit: bigint;
}

/**
 * What the account's on-chain rules should be for a rulebook, at today's USDC/CHF rate. Accounts created
 * before DeFi apps (`withApps` false) keep payments only.
 */
export function rulesTarget(rulebook: Rulebook, usdcChf: number, withApps = true): RulesTarget {
  const apps = withApps ? (rulebook.apps ?? []).map(adapterOf).filter((a): a is Address => Boolean(a)) : [];
  return {
    contactsRoot: contactsRoot(rulebook.contacts),
    dailyLimit: usdcForChf(rulebook.dailyLimitChf, usdcChf),
    frozen: rulebook.frozen,
    apps,
    appLimit: apps.length ? usdcForChf(rulebook.appLimitChf ?? DEFAULT_APP_LIMIT_CHF, usdcChf) : 0n,
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
  for (const app of Object.values(DEPLOYMENTS.adapters) as Address[]) {
    const wanted = target.apps.some((a) => isAddressEqual(a, app));
    const approved = onChain.apps.some((a) => isAddressEqual(a, app));
    if (wanted !== approved) actions.push({ kind: "setApp", app, approved: wanted });
  }
  if (target.apps.length && !limitMatches(onChain.appDailyLimit, target.appLimit)) actions.push({ kind: "setAppLimit", limit: target.appLimit });
  return actions;
}

/** The account calls still needed, from Swissquote's status of the account (JSON form). */
export function pendingSync(status: EthStatus): SelfAction[] {
  const onChain: OnChainRules = {
    ...status.onChain,
    deployed: status.deployed,
    dailyLimit: BigInt(status.onChain.dailyLimit),
    remainingToday: BigInt(status.onChain.remainingToday),
    apps: status.onChain.apps,
    appDailyLimit: BigInt(status.onChain.appDailyLimit),
    remainingAppToday: BigInt(status.onChain.remainingAppToday),
  };
  return syncActions(onChain, { ...status.target, dailyLimit: BigInt(status.target.dailyLimit), appLimit: BigInt(status.target.appLimit) });
}
