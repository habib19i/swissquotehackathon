/**
 * Chain-specific encoding of an MPC (r, s) signature, using @noble/curves.
 * Bitcoin and Ethereum both require low-S signatures; Ethereum also needs the recovery bit.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";

const CURVE_ORDER = secp256k1.Point.Fn.ORDER;

function toBigInt(bytes: Uint8Array): bigint {
  return BigInt(`0x${bytesToHex(bytes)}`);
}

/** Parses the MPC output and flips S into the lower half of the curve order when needed. */
export function lowS(r: Uint8Array, s: Uint8Array) {
  const sig = new secp256k1.Signature(toBigInt(r), toBigInt(s));
  return sig.hasHighS() ? new secp256k1.Signature(sig.r, CURVE_ORDER - sig.s) : sig;
}

/** 64-byte compact r||s, low-S. This is what a bitcoinjs-lib `Signer.sign()` must return. */
export function bitcoinCompact(r: Uint8Array, s: Uint8Array): Uint8Array {
  return lowS(r, s).toBytes("compact");
}

/** Checks a signature over a 32-byte digest (no extra hashing). */
export function verifyDigest(compact: Uint8Array, digest: Uint8Array, publicKey: Uint8Array): boolean {
  return secp256k1.verify(compact, digest, publicKey, { prehash: false });
}

/**
 * Ethereum signature: low-S plus the recovery bit, found by recovering the public key
 * for both candidate bits and keeping the one that matches the MPC key.
 */
export function ethereumSignature(r: Uint8Array, s: Uint8Array, digest: Uint8Array, publicKey: Uint8Array) {
  const sig = lowS(r, s);
  const expected = bytesToHex(secp256k1.Point.fromBytes(publicKey).toBytes(true));
  for (const yParity of [0, 1] as const) {
    const recovered = sig.addRecoveryBit(yParity).recoverPublicKey(digest).toBytes(true);
    if (bytesToHex(recovered) === expected) {
      return {
        r: `0x${sig.r.toString(16).padStart(64, "0")}` as `0x${string}`,
        s: `0x${sig.s.toString(16).padStart(64, "0")}` as `0x${string}`,
        yParity,
      };
    }
  }
  throw new Error("MPC signature does not match the wallet's public key");
}
