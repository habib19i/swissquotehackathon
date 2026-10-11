/**
 * Ownership proof on Base (CLAUDE.md section 8, step 5, for the Travel Rule): the account's MPC key signs
 * a message that binds the account to the client's Swissquote identity. Swissquote checks it the way the
 * account itself answers (ERC-1271), or, before the account's first operation, the way it will answer
 * once deployed (ERC-6492). Verification is viem's; nothing here is our own cryptography.
 */
import { hashMessage, serializeErc6492Signature, type Address, type Hex } from "viem";
import { deployment, type AccountSettings } from "./account";
import type { BaseClient } from "./client";

/** Both sides rebuild this text from their own data; neither signs a message it did not build. */
export function ethOwnershipMessage(clientNumber: string, account: Address, issuedAt: string): string {
  return [
    "Swissquote Wallet ownership proof",
    `Client: ${clientNumber}`,
    `USDC account (Base): ${account}`,
    `Date: ${issuedAt}`,
  ].join("\n");
}

/** What the MPC key signs (EIP-191), and what the account's isValidSignature checks. */
export const ethOwnershipDigest = (message: string): Hex => hashMessage(message);

/** The proof as the account accepts it; wrapped with its deployment (ERC-6492) while it does not exist yet. */
export function ethOwnershipProof(signature: Hex, deployed: boolean, settings: AccountSettings): Hex {
  if (deployed) return signature;
  const { factory, factoryData } = deployment(settings);
  return serializeErc6492Signature({ address: factory, data: factoryData, signature });
}

export function verifyEthOwnership(client: BaseClient, account: Address, message: string, proof: Hex): Promise<boolean> {
  return client.verifyHash({ address: account, hash: ethOwnershipDigest(message), signature: proof });
}
