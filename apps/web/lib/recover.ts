/**
 * "I lost my phone" (CLAUDE.md section 8), on the NEW phone:
 * 1. a new wallet passkey (Face ID), 2. the RECOVERY key, 3. Swissquote's face check (mock),
 * 4. the waiting period, during which the real client can cancel, 5. Swissquote and the provider
 * issue a new share to this phone (same key, same Savings safe; old shares are gone), 6. a new
 * Spending pocket, and the old one swept into it with the MPC key, 7. on Base, the account now accepts
 * this phone's passkey instead of the lost one.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { newPocketKey, savingsSafe, spendingPocket } from "@sqw/bitcoin";
import { KeygenParty, PARTY_ID, coordinateKeygen, localKeygenParty, remoteRecoveryParty } from "@sqw/mpc";
import type { FaceCheckAttestation, WalletRecord } from "@sqw/shared";
import { cosigner } from "./cosigner";
import { loadDkls } from "./dkls";
import type { WalletPasskey } from "./passkey";
import { saveProfile, type Client, type WalletProfile } from "./profile";
import { presentRecoveryKey, provider } from "./provider";
import { COSIGNER_URL, RECOVERY_URL } from "./services";
import { lockVault } from "./vault";
import { sweepOldPocket } from "./wallet-bitcoin";
import { updateRulesOnBase } from "./wallet-usdc";

/** Starts a recovery and asks for the recovery key. `assertion` is undefined if none was presented. */
export async function beginRecovery(walletId: string) {
  const { recovery, requestId, options } = await provider.startRecovery(walletId);
  let assertion: unknown;
  try {
    assertion = await presentRecoveryKey(options);
  } catch {
    assertion = undefined; // cancelled, or no such key on this device
  }
  return { recovery, requestId, assertion };
}

/** MOCK liveness check at Swissquote; `simulate` chooses the outcome for the demo. */
export function faceCheck(walletId: string, recoveryId: string, simulate: FaceCheckAttestation["result"]) {
  return cosigner.faceCheck(walletId, recoveryId, simulate);
}

export function verifyRecovery(recoveryId: string, requestId: string, assertion: unknown, attestation: FaceCheckAttestation) {
  return provider.verifyRecovery(recoveryId, { requestId, assertion, faceCheck: attestation });
}

export interface RecoveryResult {
  profile: WalletProfile;
  sweepTxid?: string;
  sweepError?: string;
  /** The account on Base switched to this phone's passkey (if the safe has USDC). */
  baseTxHash?: string;
  baseError?: string;
}

/** After the waiting period: the new share, the new pocket, the old pocket swept into it, the new passkey on Base. */
export async function completeRecovery(
  client: Client,
  record: WalletRecord,
  recoveryId: string,
  passkey: WalletPasskey,
  prfSecret: Uint8Array | undefined,
  onProgress: (round: number, total: number) => void,
): Promise<RecoveryResult> {
  const lib = await loadDkls();
  const mpcKey = hexToBytes(record.mpcPublicKey);
  const sessionId = crypto.randomUUID();
  const evidence = { recoveryId };

  const phone = localKeygenParty(KeygenParty.recoverAs(lib, PARTY_ID.phone, mpcKey));
  const publicKey = await coordinateKeygen(
    [
      phone,
      remoteRecoveryParty(COSIGNER_URL, PARTY_ID.cosigner, record.walletId, sessionId, PARTY_ID.phone, evidence),
      remoteRecoveryParty(RECOVERY_URL, PARTY_ID["recovery-provider"], record.walletId, sessionId, PARTY_ID.phone, evidence),
    ],
    onProgress,
  );
  if (publicKey !== record.mpcPublicKey) throw new Error("The recovered key does not match your safe. Recovery stopped.");

  const share = phone.share();
  const pocketKey = newPocketKey();
  const pocketPublicKey = secp256k1.getPublicKey(pocketKey, true);
  await lockVault({ mpcShare: share.toBytes(), pocketKey }, passkey, record.walletId, prfSecret);

  const profile: WalletProfile = {
    walletId: record.walletId,
    client,
    mpcPublicKey: record.mpcPublicKey,
    pocketPublicKey: bytesToHex(pocketPublicKey),
    savingsAddress: savingsSafe(mpcKey).address,
    pocketAddress: spendingPocket(pocketPublicKey, mpcKey).address,
    passkey,
    createdAt: new Date().toISOString(),
  };
  await saveProfile(profile);

  // Swissquote moves the refill destination to the new pocket and the passkey of the USDC
  // account to the new phone's, only for a recovery the provider completed.
  const updated = await cosigner.recovered(record.walletId, recoveryId, profile.pocketPublicKey, passkey.publicKey);
  if (updated.pocketAddress !== profile.pocketAddress) throw new Error("Swissquote recorded a different Spending pocket.");

  const result: RecoveryResult = { profile };
  try {
    result.sweepTxid = await sweepOldPocket(profile, share, record.pocketPublicKey);
  } catch (err) {
    result.sweepError = (err as Error).message;
  }
  if (updated.ethereum) {
    try {
      result.baseTxHash = (await updateRulesOnBase(profile, share))?.txHash;
    } catch (err) {
      result.baseError = (err as Error).message;
    }
  }
  share.free();
  return result;
}
