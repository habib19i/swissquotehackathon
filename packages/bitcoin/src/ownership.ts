/**
 * Ownership proof (CLAUDE.md section 8, step 5, for the Travel Rule): a BIP-322 signature by the
 * Savings safe's MPC key over a message that binds the safe to the client's Swissquote identity.
 * Built and verified with bip322-js; nothing here is our own cryptography.
 *
 * bip322-js relies on Node's global `Buffer`: in a browser, set `globalThis.Buffer` (from the
 * `buffer` package) before importing this module.
 */
import { BIP322, Verifier } from "bip322-js";
import { Transaction, type Psbt } from "bitcoinjs-lib";
import { inputSighash } from "./spend";

/** Both sides rebuild this text from their own data; neither signs a message it did not build. */
export function ownershipMessage(clientNumber: string, safeAddress: string, issuedAt: string): string {
  return [
    "Swissquote Wallet ownership proof",
    `Client: ${clientNumber}`,
    `Savings safe: ${safeAddress}`,
    `Date: ${issuedAt}`,
  ].join("\n");
}

/** The BIP-322 "to_sign" transaction. Its single input is signed by the safe's key (P2WPKH, SIGHASH_ALL). */
export function ownershipToSign(message: string, safeOutput: Uint8Array): Psbt {
  const script = Buffer.from(safeOutput);
  const toSpend = BIP322.buildToSpendTx(message, script);
  return BIP322.buildToSignTx(toSpend.getId(), script);
}

/** The digest the MPC key signs for the proof, computed from the to_sign transaction (BIP-143). */
export function ownershipDigest(message: string, safeOutput: Uint8Array, mpcPublicKey: Uint8Array): Uint8Array {
  const toSign = ownershipToSign(message, safeOutput);
  const tx = Transaction.fromBuffer(toSign.data.getTransaction());
  return inputSighash(tx, 0, mpcPublicKey, 0n);
}

/** Base64 BIP-322 "simple" signature from a signed to_sign transaction. */
export function encodeOwnershipProof(signed: Psbt): string {
  signed.finalizeAllInputs();
  return BIP322.encodeWitness(signed);
}

export function verifyOwnershipProof(address: string, message: string, signature: string): boolean {
  try {
    return Verifier.verifySignature(address, message, signature, true);
  } catch {
    return false;
  }
}
