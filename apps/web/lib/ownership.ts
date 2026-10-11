/**
 * Ownership proof (CLAUDE.md section 8, step 5): the Savings safe signs a BIP-322 message binding it to
 * the client's Swissquote identity, and the USDC account an ERC-1271 one. Swissquote verifies
 * them and marks the safe "verified": no whitelist, no screenshots (Travel Rule).
 */
import { hexToBytes } from "@noble/hashes/utils.js";
import { savingsSafe, signAllInputs } from "@sqw/bitcoin";
import { hexToBytes as hexToBytes0x } from "viem";
import { accountSettings, ethOwnershipDigest, ethOwnershipMessage, ethOwnershipProof, isDeployed, mpcSignature } from "@sqw/ethereum";
import { bitcoinCompact, ethereumSignature, verifyDigest, type DklsKeyshare } from "@sqw/mpc";
import type { EthAccountRecord, WalletRecord } from "@sqw/shared";
import { cosigner, cosignWithSwissquote } from "./cosigner";
import type { WalletProfile } from "./profile";
import { baseReader, usdcAccount } from "./wallet-usdc";

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

/**
 * The USDC account's proof: the MPC key signs the message, and Swissquote asks the account
 * itself (ERC-1271), or, before its first operation, its future deployment (ERC-6492).
 */
export async function proveUsdcOwnership(profile: WalletProfile, share: DklsKeyshare): Promise<EthAccountRecord> {
  const account = await usdcAccount(profile);
  const { issuedAt } = await cosigner.ethOwnershipChallenge(profile.walletId);
  const digest = hexToBytes0x(ethOwnershipDigest(ethOwnershipMessage(profile.client.clientNumber, account.address, issuedAt)));
  const { r, s } = await cosignWithSwissquote(share, profile.walletId, { kind: "eth-ownership-proof" }, digest);
  const signature = mpcSignature(ethereumSignature(r, s, digest, hexToBytes(profile.mpcPublicKey)));
  const deployed = await isDeployed(baseReader, account.address);
  return cosigner.ethOwnershipProof(profile.walletId, ethOwnershipProof(signature, deployed, accountSettings(account)));
}
