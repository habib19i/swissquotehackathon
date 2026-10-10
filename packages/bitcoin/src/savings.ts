/**
 * Savings safe payments and Spending pocket refills: both spend the 2-of-3 MPC address, so the
 * phone and Swissquote (or, if Swissquote is gone, the recovery provider) sign together.
 */
import type { SavingsSafe } from "./addresses";
import type { Utxo } from "./esplora";
import { buildSpend, maxSpendable, savingsSource, type Spend } from "./spend";

export function buildSavingsPayment(req: {
  safe: SavingsSafe;
  utxos: Utxo[];
  to: string;
  amount: bigint;
  feeRate: number;
}): Spend {
  return buildSpend({ ...req, source: savingsSource(req.safe) });
}

export function maxSavingsAmount(safe: SavingsSafe, utxos: Utxo[], feeRate: number): bigint {
  return maxSpendable(savingsSource(safe), utxos, feeRate);
}

/** The pocket is refilled once it falls below this share of its target size. */
export const REFILL_THRESHOLD = 0.5;

/**
 * How much to move from the Savings safe to bring the pocket back to its target size.
 * Zero while the pocket still holds at least half of its target.
 */
export function refillAmount(pocketBalance: bigint, target: bigint): bigint {
  const threshold = (target * BigInt(REFILL_THRESHOLD * 100)) / 100n;
  return pocketBalance >= threshold ? 0n : target - pocketBalance;
}
