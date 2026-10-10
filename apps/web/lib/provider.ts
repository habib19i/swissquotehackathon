/**
 * The app's client for the independent recovery provider (share 3, "TEE" mock). It holds the
 * RECOVERY key registration and runs recoveries; when Swissquote is gone it co-signs with the phone,
 * with the recovery key's approval.
 */
import { startAuthentication } from "@simplewebauthn/browser";
import { PARTY_ID, SignParty, coordinateSign, remoteSigner, type DklsKeyshare, type Signature } from "@sqw/mpc";
import type { FaceCheckAttestation, RecoveryKeyKind, RecoveryRequest } from "@sqw/shared";
import { loadDkls } from "./dkls";
import { serviceClient } from "./http";
import { RECOVERY_URL } from "./services";

const call = serviceClient(RECOVERY_URL, "The recovery provider");

/** WebAuthn options as the provider sends them (JSON form, passed straight to the browser library). */
type Options = Parameters<typeof startAuthentication>[0]["optionsJSON"];

export const provider = {
  recoveryKey: (walletId: string) => call<{ registered: boolean; kind?: RecoveryKeyKind }>(`/wallets/${walletId}/recovery-key`),
  recoveryKeyOptions: (walletId: string, clientNumber: string, kind: RecoveryKeyKind) =>
    call<{ requestId: string; options: unknown }>(`/wallets/${walletId}/recovery-key/options`, { clientNumber, kind }),
  registerRecoveryKey: (walletId: string, requestId: string, response: unknown) =>
    call<{ registered: boolean; kind: RecoveryKeyKind }>(`/wallets/${walletId}/recovery-key`, { requestId, response }),

  startRecovery: (walletId: string) =>
    call<{ recovery: RecoveryRequest; requestId: string; options: Options }>(`/wallets/${walletId}/recoveries`, {}),
  verifyRecovery: (recoveryId: string, body: { requestId: string; assertion?: unknown; faceCheck?: FaceCheckAttestation }) =>
    call<RecoveryRequest>(`/recoveries/${recoveryId}/verify`, body),
  cancelRecovery: (recoveryId: string) => call<RecoveryRequest>(`/recoveries/${recoveryId}/cancel`, {}),
  recovery: (recoveryId: string) => call<RecoveryRequest & { ready: boolean }>(`/recoveries/${recoveryId}`),
  activeRecovery: (walletId: string) => call<RecoveryRequest | null>(`/wallets/${walletId}/recoveries/active`),

  offlineApproval: (walletId: string, txid: string) =>
    call<{ requestId: string; options: Options }>(`/wallets/${walletId}/offline-approval`, { txid }),
  verifyOfflineApproval: (walletId: string, requestId: string, assertion: unknown) =>
    call<{ approvalToken: string }>(`/wallets/${walletId}/offline-approval/verify`, { requestId, assertion }),
};

/** Asks for the client's RECOVERY key (security key or synced passkey). Throws if cancelled. */
export function presentRecoveryKey(options: Options) {
  return startAuthentication({ optionsJSON: options });
}

/**
 * Phone + recovery provider sign `digest` together, when Swissquote is gone. The provider checks its
 * own rules (Swissquote really down, recovery-key approval of this transaction) and computes the digest.
 */
export async function cosignWithProvider(
  share: DklsKeyshare,
  walletId: string,
  request: unknown,
  digest: Uint8Array,
): Promise<Signature> {
  const lib = await loadDkls();
  const remote = remoteSigner(RECOVERY_URL, PARTY_ID["recovery-provider"], walletId, crypto.randomUUID(), request);
  return coordinateSign(SignParty.create(lib, share), remote, digest);
}
