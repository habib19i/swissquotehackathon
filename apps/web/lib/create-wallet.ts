/**
 * Wallet creation (CLAUDE.md section 8): Face ID creates the wallet passkey, then the phone,
 * Swissquote and the recovery provider generate the 2-of-3 key together. Each keeps only its share.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { newPocketKey, savingsSafe, spendingPocket } from "@sqw/bitcoin";
import { KeygenParty, PARTY_ID, coordinateKeygen, localKeygenParty, remoteKeygenParty } from "@sqw/mpc";
import type { DklsLib } from "@sqw/mpc";
import { confirmWithFaceId, createWalletPasskey, type WalletPasskey } from "./passkey";
import { saveProfile, type Client, type WalletProfile } from "./profile";
import { COSIGNER_URL, RECOVERY_URL } from "./services";
import { lockVault } from "./vault";

let dkls: Promise<DklsLib> | undefined;

/** Loads the browser build of DKLs23 once (the .wasm is copied to /public by scripts/copy-wasm.mjs). */
function loadDkls(): Promise<DklsLib> {
  dkls ??= import("@silencelaboratories/dkls-wasm-ll-web").then(async (lib) => {
    await lib.default("/wasm/dkls.wasm");
    return lib;
  });
  return dkls;
}

/** Step 1: Face ID creates the wallet passkey (and, with PRF, the secret that locks the vault). */
export async function setUpFaceId(client: Client) {
  const { passkey, secret } = await createWalletPasskey(client);
  // Some authenticators only release the PRF secret on a sign-in, not at creation.
  const prfSecret = passkey.protection === "prf" ? (secret ?? (await confirmWithFaceId(passkey))) : undefined;
  return { passkey, prfSecret };
}

/** Step 2: distributed key generation, then the phone's secrets are locked in its vault. */
export async function createSafe(
  client: Client,
  passkey: WalletPasskey,
  prfSecret: Uint8Array | undefined,
  onProgress: (round: number, total: number) => void,
): Promise<WalletProfile> {
  const lib = await loadDkls();
  const walletId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();

  const phone = localKeygenParty(KeygenParty.create(lib, PARTY_ID.phone));
  const mpcPublicKey = await coordinateKeygen(
    [
      phone,
      remoteKeygenParty(COSIGNER_URL, PARTY_ID.cosigner, walletId, sessionId),
      remoteKeygenParty(RECOVERY_URL, PARTY_ID["recovery-provider"], walletId, sessionId),
    ],
    onProgress,
  );

  const pocketKey = newPocketKey();
  const pocketPublicKey = secp256k1.getPublicKey(pocketKey, true);
  await lockVault({ mpcShare: phone.share().toBytes(), pocketKey }, passkey, walletId, prfSecret);

  const mpcKey = hexToBytes(mpcPublicKey);
  const profile: WalletProfile = {
    walletId,
    client,
    mpcPublicKey,
    pocketPublicKey: bytesToHex(pocketPublicKey),
    savingsAddress: savingsSafe(mpcKey).address,
    pocketAddress: spendingPocket(pocketPublicKey, mpcKey).address,
    passkey,
    createdAt: new Date().toISOString(),
  };
  await saveProfile(profile);
  return profile;
}
