/**
 * Finishes a safe with Swissquote: registration (write-once) and the ownership proof.
 * Safe to call again; steps already done are skipped.
 */
import type { DklsKeyshare } from "@sqw/mpc";
import type { Plan, WalletRecord } from "@sqw/shared";
import { CosignerError, cosigner } from "./cosigner";
import { proveOwnership } from "./ownership";
import type { WalletProfile } from "./profile";

/** Swissquote's record of this safe, or undefined if it is not registered yet. */
export async function swissquoteRecord(walletId: string): Promise<WalletRecord | undefined> {
  try {
    return await cosigner.wallet(walletId);
  } catch (err) {
    if (err instanceof CosignerError && err.status === 404) return undefined;
    throw err;
  }
}

export async function finishSetup(profile: WalletProfile, share: DklsKeyshare, plan: Plan = "standard"): Promise<WalletRecord> {
  let record = await swissquoteRecord(profile.walletId);
  if (!record) {
    record = await cosigner.register({
      walletId: profile.walletId,
      clientNumber: profile.client.clientNumber,
      pocketPublicKey: profile.pocketPublicKey,
      plan,
    });
    // Swissquote computes the addresses on its side; both must agree before anything is funded.
    if (record.savingsAddress !== profile.savingsAddress || record.pocketAddress !== profile.pocketAddress) {
      throw new Error("Swissquote computed different addresses for this safe. Setup stopped.");
    }
  }
  if (!record.ownershipVerifiedAt) record = await proveOwnership(profile, share);
  return record;
}
