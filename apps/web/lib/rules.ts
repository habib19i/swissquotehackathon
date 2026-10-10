/**
 * The client's rulebook (CLAUDE.md section 6), kept by Swissquote. Changes are signed with the MPC
 * key (phone + Swissquote); Swissquote enforces the waiting period on loosening changes.
 * The phone keeps a copy so contacts stay available when Swissquote is offline.
 * On Base, the client's account enforces the rules itself: they are written there with the MPC key
 * once in force (tightening: at once, with the same Face ID; loosening: after the waiting period).
 */
import { get, set } from "idb-keyval";
import { DEMO_CONTACTS, defaultRulebook, rulebookChangeDigest, type EthSent, type Rulebook, type RulebookChange } from "@sqw/shared";
import { cosigner, cosignWithSwissquote } from "./cosigner";
import type { WalletProfile } from "./profile";
import { withShare } from "./wallet-bitcoin";
import { updateRulesOnBase } from "./wallet-usdc";

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

export interface ChangeResult {
  id: string;
  /** The rules written on Base with the same Face ID, if the change is already in force. */
  base?: EthSent | { error: string };
}

/**
 * Face ID unlocks the phone's share; the phone and Swissquote sign the change. Swissquote applies it
 * now (tightening) or after the waiting period (loosening).
 */
export async function requestChange(profile: WalletProfile, change: RulebookChange): Promise<ChangeResult> {
  const nonce = crypto.randomUUID();
  const digest = rulebookChangeDigest(profile.walletId, change, nonce);
  return withShare(profile, async (share) => {
    await cosignWithSwissquote(share, profile.walletId, { kind: "rulebook-change", change, nonce }, digest);
    try {
      return { id: nonce, base: await updateRulesOnBase(profile, share) };
    } catch (err) {
      return { id: nonce, base: { error: (err as Error).message } };
    }
  });
}
