/**
 * The RECOVERY passkey (CLAUDE.md section 5): separate from the wallet passkey, registered only with
 * the independent recovery provider, and never used for daily payments.
 */
import { startRegistration } from "@simplewebauthn/browser";
import type { RecoveryKeyKind } from "@sqw/shared";
import type { WalletProfile } from "./profile";
import { provider } from "./provider";

type RegistrationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

export async function addRecoveryKey(profile: WalletProfile, kind: RecoveryKeyKind) {
  const { requestId, options } = await provider.recoveryKeyOptions(profile.walletId, profile.client.clientNumber, kind);
  const response = await startRegistration({ optionsJSON: options as RegistrationOptions });
  return provider.registerRecoveryKey(profile.walletId, requestId, response);
}

export async function hasRecoveryKey(walletId: string): Promise<boolean | undefined> {
  return provider
    .recoveryKey(walletId)
    .then((r) => r.registered)
    .catch(() => undefined);
}
