/**
 * The client's rulebook (CLAUDE.md section 6), kept by Swissquote. Changes are signed with the MPC
 * key (phone + Swissquote); Swissquote enforces the waiting period on loosening changes.
 * The phone keeps a copy so contacts stay available when Swissquote is offline.
 */
import { get, set } from "idb-keyval";
import { DEMO_CONTACTS, defaultRulebook, rulebookChangeDigest, type Rulebook, type RulebookChange } from "@sqw/shared";
import { cosigner, cosignWithSwissquote } from "./cosigner";
import type { WalletProfile } from "./profile";
import { withShare } from "./wallet-bitcoin";

export const RULEBOOK_CACHE = "sqw.rulebook";

export async function loadRulebook(walletId: string): Promise<Rulebook> {
  try {
    const rulebook = await cosigner.rulebook(walletId);
    await set(RULEBOOK_CACHE, rulebook);
    return rulebook;
  } catch {
    return (await get<Rulebook>(RULEBOOK_CACHE)) ?? { ...defaultRulebook(), contacts: DEMO_CONTACTS };
  }
}

/**
 * Face ID unlocks the phone's share; the phone and Swissquote sign the change. Swissquote applies it
 * now (tightening) or after the waiting period (loosening). Returns the change id.
 */
export async function requestChange(profile: WalletProfile, change: RulebookChange): Promise<string> {
  const nonce = crypto.randomUUID();
  const digest = rulebookChangeDigest(profile.walletId, change, nonce);
  await withShare(profile, (share) =>
    cosignWithSwissquote(share, profile.walletId, { kind: "rulebook-change", change, nonce }, digest),
  );
  return nonce;
}
