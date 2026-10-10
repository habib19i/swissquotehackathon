/**
 * The phone's secrets: MPC share 1 and the Spending pocket key. Encrypted with AES-GCM (WebCrypto)
 * and kept in this browser's IndexedDB only. They never leave the device.
 */
import { get, set } from "idb-keyval";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { confirmWithFaceId, type WalletPasskey } from "./passkey";

export interface VaultSecrets {
  mpcShare: Uint8Array;
  pocketKey: Uint8Array;
}

interface StoredVault {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

const VAULT = "sqw.vault";
const DEVICE_KEY = "sqw.vault-device-key";
const encoder = new TextEncoder();

/** Vault key derived from the passkey's PRF secret (HKDF-SHA256), bound to this wallet. */
async function prfVaultKey(secret: Uint8Array, walletId: string): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey("raw", secret as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: encoder.encode(walletId), info: encoder.encode("sqw-wallet-vault-v1") },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Fallback when the browser has no PRF: a non-extractable AES key kept by the browser.
 * Face ID still gates every use in the app, but the key itself does not depend on it.
 */
async function deviceVaultKey(): Promise<CryptoKey> {
  const existing = await get<CryptoKey>(DEVICE_KEY);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await set(DEVICE_KEY, key);
  return key;
}

function vaultKey(passkey: WalletPasskey, walletId: string, prfSecret: Uint8Array | undefined) {
  if (passkey.protection === "device-key") return deviceVaultKey();
  if (!prfSecret) throw new Error("Face ID is needed to open your safe");
  return prfVaultKey(prfSecret, walletId);
}

export async function lockVault(
  secrets: VaultSecrets,
  passkey: WalletPasskey,
  walletId: string,
  prfSecret: Uint8Array | undefined,
) {
  const key = await vaultKey(passkey, walletId, prfSecret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(
    JSON.stringify({ mpcShare: bytesToHex(secrets.mpcShare), pocketKey: bytesToHex(secrets.pocketKey) }),
  );
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  await set(VAULT, { iv, ciphertext } satisfies StoredVault);
}

/** Asks for Face ID, then decrypts the phone's secrets. Callers should drop them after use. */
export async function unlockVault(passkey: WalletPasskey, walletId: string): Promise<VaultSecrets> {
  const prfSecret = await confirmWithFaceId(passkey);
  const stored = await get<StoredVault>(VAULT);
  if (!stored) throw new Error("This phone does not hold a key for this safe");
  const key = await vaultKey(passkey, walletId, prfSecret);
  const plaintext = await crypto.subtle
    .decrypt({ name: "AES-GCM", iv: stored.iv }, key, stored.ciphertext)
    .catch(() => {
      throw new Error("Face ID did not unlock your safe");
    });
  const { mpcShare, pocketKey } = JSON.parse(new TextDecoder().decode(plaintext));
  return { mpcShare: hexToBytes(mpcShare), pocketKey: hexToBytes(pocketKey) };
}
