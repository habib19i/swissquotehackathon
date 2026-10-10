import type { FaceCheckAttestation } from "./types";

/** The exact text Swissquote signs for a face check, and the recovery provider verifies. */
export function faceCheckPayload(a: Omit<FaceCheckAttestation, "signature">): string {
  return JSON.stringify(["swissquote-face-check-v1", a.walletId, a.recoveryId, a.result, a.at]);
}
