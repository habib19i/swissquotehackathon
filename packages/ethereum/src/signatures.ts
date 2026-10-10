/**
 * Signature formats RulebookAccount accepts: a one-byte key type, then the key's signature.
 * Parsing uses @noble/curves; the account verifies with OpenZeppelin (ECDSA, WebAuthn/P256).
 */
import { p256 } from "@noble/curves/nist.js";
import { concat, encodeAbiParameters, numberToHex, toHex, type Hex } from "viem";

export const KEY_TYPE = { mpc: "0x00", passkey: "0x01" } as const;

/** The MPC key's signature over the UserOperation hash: r, s (low-S) and v. */
export function mpcSignature({ r, s, yParity }: { r: Hex; s: Hex; yParity: 0 | 1 }): Hex {
  return concat([KEY_TYPE.mpc, r, s, numberToHex(27 + yParity, { size: 1 })]);
}

/** A WebAuthn assertion as the browser returns it (signature in DER). */
export interface WebAuthnAssertion {
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
}

const P256_ORDER = p256.Point.Fn.ORDER;
const toBytes32 = (n: bigint): Hex => numberToHex(n, { size: 32 });

/**
 * The wallet passkey's signature, laid out for OpenZeppelin's WebAuthn.tryDecodeAuth. S is moved into
 * the lower half of the curve order, as OpenZeppelin's P256 requires (the same signature, mirrored).
 */
export function passkeySignature({ authenticatorData, clientDataJSON, signature }: WebAuthnAssertion): Hex {
  const sig = p256.Signature.fromBytes(signature, "der");
  const s = sig.hasHighS() ? P256_ORDER - sig.s : sig.s;

  const json = new TextDecoder().decode(clientDataJSON);
  const challengeIndex = json.indexOf('"challenge":"');
  const typeIndex = json.indexOf('"type":"');
  if (challengeIndex < 0 || typeIndex < 0) throw new Error("Unexpected passkey response.");

  const auth = encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "bytes" }],
    [toBytes32(sig.r), toBytes32(s), BigInt(challengeIndex), BigInt(typeIndex), toHex(authenticatorData), toHex(clientDataJSON)],
  );
  return concat([KEY_TYPE.passkey, auth]);
}
