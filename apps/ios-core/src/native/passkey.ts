/**
 * The WALLET passkey in the iOS app (replaces apps/web/lib/passkey.ts in the core): a P-256 key created in
 * the phone's Secure Enclave, usable only after Face ID. It never leaves the Secure Enclave.
 *
 * Base payments: the client's account checks a WebAuthn assertion (OpenZeppelin `WebAuthn.verify`: the
 * challenge, the user-present and user-verified flags, and the P-256 signature; not the origin or the
 * rpIdHash). The core builds the assertion here, and the Secure Enclave signs
 * `authenticatorData || SHA-256(clientDataJSON)` after Face ID, exactly what a passkey signs.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import type { WebAuthnAssertion } from "@sqw/ethereum";
import { native } from "../bridge";

export interface WalletPasskey {
  /** The Secure Enclave key's tag in the iOS Keychain. */
  credentialId: string;
  /** Unused in the iOS app (no PRF: the Keychain vault asks for Face ID itself). */
  prfSalt: string;
  protection: "prf" | "device-key" | "secure-enclave";
  /** COSE algorithm: -7 = ES256 (P-256). The Secure Enclave only makes P-256 keys. */
  algorithm: number;
  /** Hex SubjectPublicKeyInfo, as the web app records it. */
  publicKey?: string;
}

/** Identifies the iOS app in the assertion; the account on Base does not check it. */
export const IOS_RP_ID = "wallet.swissquote.prototype";
const IOS_ORIGIN = "ios:ch.swissquote.wallet.prototype";
/** User present (0x01) and user verified (0x04): Face ID succeeded. */
const FLAGS_UP_UV = 0x05;
/** DER prefix of a P-256 SubjectPublicKeyInfo, before the 65-byte uncompressed point. */
const P256_SPKI_PREFIX = "3059301306072a8648ce3d020106082a8648ce3d030107034200";

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function passkeysSupported(): boolean {
  return true;
}

/** Face ID creates the Secure Enclave key. There is no PRF secret: the Keychain protects the vault. */
export async function createWalletPasskey(client: { name: string; clientNumber: string }) {
  const { keyId, publicKey } = await native<{ keyId: string; publicKey: string }>("faceId.create", { label: client.clientNumber });
  const point = hexToBytes(publicKey);
  if (point.length !== 65 || point[0] !== 0x04) throw new Error("The phone returned an unexpected Face ID key.");
  const passkey: WalletPasskey = {
    credentialId: keyId,
    prfSalt: "",
    protection: "secure-enclave",
    algorithm: -7,
    publicKey: P256_SPKI_PREFIX + publicKey,
  };
  return { passkey, secret: undefined as Uint8Array<ArrayBuffer> | undefined };
}

/** The WebAuthn envelope a passkey would sign for `challenge` (what `RulebookAccount` verifies). */
export function assertionEnvelope(challenge: Uint8Array) {
  const clientDataJSON = new TextEncoder().encode(
    JSON.stringify({ type: "webauthn.get", challenge: base64url(challenge), origin: IOS_ORIGIN, crossOrigin: false }),
  );
  const authenticatorData = concatBytes(sha256(new TextEncoder().encode(IOS_RP_ID)), new Uint8Array([FLAGS_UP_UV, 0, 0, 0, 0]));
  return { authenticatorData, clientDataJSON, message: concatBytes(authenticatorData, sha256(clientDataJSON)) };
}

/** Face ID signs `challenge` (a daily USDC payment's UserOperation hash) with the Secure Enclave key. */
export async function signWithPasskey(passkey: WalletPasskey, challenge: Uint8Array): Promise<WebAuthnAssertion> {
  const { authenticatorData, clientDataJSON, message } = assertionEnvelope(challenge);
  const { signature } = await native<{ signature: string }>("faceId.sign", {
    keyId: passkey.credentialId,
    message: bytesToHex(message),
    reason: "Confirm this payment",
  });
  return { authenticatorData, clientDataJSON, signature: hexToBytes(signature) };
}

/** A Face ID check with nothing to sign. Throws if the client cancels or Face ID fails. */
export async function confirmWithFaceId(passkey: WalletPasskey): Promise<Uint8Array | undefined> {
  await native("faceId.confirm", { keyId: passkey.credentialId, reason: "Open your safe" });
  return undefined;
}
