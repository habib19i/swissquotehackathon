/**
 * Verifies Swissquote's face-check attestation (the face check itself is a MOCK at Swissquote).
 * Swissquote's attestation key is fetched directly from Swissquote, never through the phone.
 */
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { faceCheckPayload, type FaceCheckAttestation } from "@sqw/shared";

let attestationKey: Uint8Array | undefined;

async function swissquoteAttestationKey(cosignerUrl: string): Promise<Uint8Array> {
  if (!attestationKey) {
    const body = (await (await fetch(`${cosignerUrl}/mock/face-check/key`)).json()) as { publicKey: string };
    attestationKey = hexToBytes(body.publicKey);
  }
  return attestationKey;
}

/** Plain-language reasons why the attestation does not support this recovery; empty if it does. */
export async function checkFaceAttestation(
  cosignerUrl: string,
  attestation: FaceCheckAttestation | undefined,
  walletId: string,
  recoveryId: string,
): Promise<string[]> {
  if (!attestation) return ["Swissquote's face check was not done."];
  if (attestation.walletId !== walletId || attestation.recoveryId !== recoveryId) {
    return ["This face check was made for another recovery."];
  }
  let valid = false;
  try {
    const digest = sha256(new TextEncoder().encode(faceCheckPayload(attestation)));
    valid = schnorr.verify(hexToBytes(attestation.signature), digest, await swissquoteAttestationKey(cosignerUrl));
  } catch {
    valid = false;
  }
  if (!valid) return ["Swissquote's face check could not be verified."];
  if (attestation.result !== "match") return ["The face check did not match the client's identity on file at Swissquote."];
  return [];
}
