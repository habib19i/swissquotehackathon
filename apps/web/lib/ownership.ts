/**
 * Ownership proof (CLAUDE.md section 8, step 5): the Savings safe signs a BIP-322 message binding it to
 * the client's Swissquote identity. Swissquote verifies it and marks the safe "verified": no whitelist,
 * no screenshots (Travel Rule).
 */
import { hexToBytes } from "@noble/hashes/utils.js";
import { savingsSafe, signAllInputs } from "@sqw/bitcoin";
import { bitcoinCompact, verifyDigest, type DklsKeyshare } from "@sqw/mpc";
import type { WalletRecord } from "@sqw/shared";
import { cosigner, cosignWithSwissquote } from "./cosigner";
import type { WalletProfile } from "./profile";

/** bip322-js expects Node's global Buffer; load the browser polyfill first. */
async function loadOwnership() {
  const { Buffer } = await import("buffer");
  (globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;
  return import("@sqw/bitcoin/ownership");
}

export async function proveOwnership(profile: WalletProfile, share: DklsKeyshare): Promise<WalletRecord> {
  const { ownershipMessage, ownershipToSign, encodeOwnershipProof } = await loadOwnership();
  const { issuedAt } = await cosigner.ownershipChallenge(profile.walletId);

  // The phone builds the message from its own data; Swissquote only fixes the date.
  const message = ownershipMessage(profile.client.clientNumber, profile.savingsAddress, issuedAt);
  const mpcKey = hexToBytes(profile.mpcPublicKey);
  const toSign = ownershipToSign(message, savingsSafe(mpcKey).output);

  await signAllInputs(
    toSign,
    () => ({
      publicKey: mpcKey,
      sign: async (hash: Uint8Array) => {
        const { r, s } = await cosignWithSwissquote(share, profile.walletId, { kind: "ownership-proof" }, hash);
        return bitcoinCompact(r, s);
      },
    }),
    (pk, hash, sig) => verifyDigest(sig, hash, pk),
  );
  return cosigner.ownershipProof(profile.walletId, encodeOwnershipProof(toSign));
}
