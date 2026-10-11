/**
 * The phone's secrets in the iOS app (replaces apps/web/lib/vault.ts in the core): MPC share 1 and the
 * Spending pocket key, kept as one Keychain item that only Face ID opens (`.biometryCurrentSet`, this
 * device only, never in backups). The core holds them only for the operation that needs them.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { native } from "../bridge";
import type { WalletPasskey } from "./passkey";

export interface VaultSecrets {
  mpcShare: Uint8Array;
  pocketKey: Uint8Array;
}

/** Storage key the web app uses for its vault; deleting it in the iOS app forgets the phone's secrets. */
export const VAULT_KEY = "sqw.vault";
export const VAULT_STORAGE_KEYS = [VAULT_KEY];

export async function lockVault(secrets: VaultSecrets, _passkey: WalletPasskey, walletId: string, _prfSecret: Uint8Array | undefined) {
  await native("vault.save", { walletId, mpcShare: bytesToHex(secrets.mpcShare), pocketKey: bytesToHex(secrets.pocketKey) });
}

/** Face ID opens the Keychain item. Callers wipe the secrets after use. */
export async function unlockVault(_passkey: WalletPasskey, walletId: string): Promise<VaultSecrets> {
  const { mpcShare, pocketKey } = await native<{ mpcShare: string; pocketKey: string }>("vault.unlock", {
    walletId,
    reason: "Open your safe",
  });
  return { mpcShare: hexToBytes(mpcShare), pocketKey: hexToBytes(pocketKey) };
}
