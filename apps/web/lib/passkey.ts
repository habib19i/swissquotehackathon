/**
 * The WALLET passkey (CLAUDE.md section 5): created with Face ID on this device, used to unlock share 1.
 *
 * With the WebAuthn PRF extension, every Face ID check returns a secret derived inside the
 * authenticator; the vault key is derived from it, so the phone's secrets cannot be decrypted
 * without Face ID. Browsers without PRF fall back to a device key (see vault.ts), clearly reported.
 */
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { WebAuthnAssertion } from "@sqw/ethereum";

export interface WalletPasskey {
  /** Hex credential id. */
  credentialId: string;
  /** Hex salt for the PRF evaluation. */
  prfSalt: string;
  /** "prf": vault key comes from the passkey. "device-key": PRF unsupported, Face ID gates use only. */
  protection: "prf" | "device-key";
  /** COSE algorithm: -7 = ES256 (P-256, verifiable on-chain in M4), -257 = RS256. */
  algorithm: number;
  /** Hex SubjectPublicKeyInfo, kept for on-chain verification (M4). */
  publicKey?: string;
}

interface PrfResult {
  enabled?: boolean;
  results?: { first?: ArrayBuffer };
}

const RP_NAME = "Swissquote Wallet (prototype)";

function random(bytes: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(bytes));
}

function prfOf(credential: PublicKeyCredential): PrfResult | undefined {
  return (credential.getClientExtensionResults() as { prf?: PrfResult }).prf;
}

function prfInput(salt: Uint8Array<ArrayBuffer>) {
  return { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs;
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window && window.isSecureContext;
}

/**
 * Face ID creates the wallet passkey. Returns the passkey record and, when the authenticator
 * supports PRF, the secret to derive the vault key from (may need a second Face ID check).
 */
export async function createWalletPasskey(client: { name: string; clientNumber: string }) {
  const salt = random(32);
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: RP_NAME },
      user: { id: random(16), name: client.clientNumber, displayName: client.name },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "preferred",
        userVerification: "required",
      },
      extensions: prfInput(salt),
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error("Face ID was cancelled");

  const response = credential.response as AuthenticatorAttestationResponse;
  const spki = response.getPublicKey?.();
  const prf = prfOf(credential);

  const passkey: WalletPasskey = {
    credentialId: bytesToHex(new Uint8Array(credential.rawId)),
    prfSalt: bytesToHex(salt),
    protection: prf?.enabled || prf?.results?.first ? "prf" : "device-key",
    algorithm: response.getPublicKeyAlgorithm?.() ?? -7,
    publicKey: spki ? bytesToHex(new Uint8Array(spki)) : undefined,
  };
  const secret = prf?.results?.first ? new Uint8Array(prf.results.first) : undefined;
  return { passkey, secret };
}

/**
 * Face ID signs `challenge` with the wallet passkey: a daily USDC payment's UserOperation hash, which
 * the client's account on Base verifies on-chain (P-256). No PRF here: the vault stays closed.
 */
export async function signWithPasskey(passkey: WalletPasskey, challenge: Uint8Array): Promise<WebAuthnAssertion> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: challenge as Uint8Array<ArrayBuffer>,
      allowCredentials: [{ type: "public-key", id: hexToBytes(passkey.credentialId) as Uint8Array<ArrayBuffer> }],
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Face ID was cancelled");
  const response = assertion.response as AuthenticatorAssertionResponse;
  return {
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    signature: new Uint8Array(response.signature),
  };
}

/**
 * Face ID check with the wallet passkey. Returns the PRF secret when the passkey supports it.
 * Throws if the client cancels or the check fails: callers must not proceed without it.
 */
export async function confirmWithFaceId(passkey: WalletPasskey): Promise<Uint8Array | undefined> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: random(32),
      allowCredentials: [{ type: "public-key", id: hexToBytes(passkey.credentialId) as Uint8Array<ArrayBuffer> }],
      userVerification: "required",
      extensions: passkey.protection === "prf" ? prfInput(hexToBytes(passkey.prfSalt) as Uint8Array<ArrayBuffer>) : undefined,
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Face ID was cancelled");

  const flags = new Uint8Array((assertion.response as AuthenticatorAssertionResponse).authenticatorData)[32];
  if ((flags & 0x04) === 0) throw new Error("Face ID did not verify you");

  const first = prfOf(assertion)?.results?.first;
  if (passkey.protection === "prf" && !first) throw new Error("This passkey did not unlock your safe");
  return first ? new Uint8Array(first) : undefined;
}
