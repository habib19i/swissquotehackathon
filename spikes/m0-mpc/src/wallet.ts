/**
 * M0 spike helpers. SPIKE ONLY: the three shares are written to one local folder so a single
 * script can drive all holders. From M1 on, each holder keeps its share in its own process and database.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { networks, payments } from "bitcoinjs-lib";
import { publicKeyToAddress } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { PARTY_ID } from "@sqw/mpc";
import { Keyshare } from "@sqw/mpc/node";
import type { ShareHolder } from "@sqw/shared";

const SHARES_DIR = fileURLToPath(new URL("../.shares/", import.meta.url));
const HOLDERS = Object.keys(PARTY_ID) as ShareHolder[];

export const signet = networks.testnet; // signet shares testnet's address format (tb1...)

/**
 * Runs a script and reports failures in plain text. Sets the exit code instead of calling
 * process.exit(), which crashes Node on Windows while fetch handles are still closing.
 */
export function run(main: () => Promise<void>) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

export function saveShares(shares: Keyshare[]) {
  mkdirSync(SHARES_DIR, { recursive: true });
  for (const holder of HOLDERS) {
    writeFileSync(`${SHARES_DIR}${holder}.bin`, shares[PARTY_ID[holder]].toBytes());
  }
}

export function hasShares(): boolean {
  return HOLDERS.every((holder) => existsSync(`${SHARES_DIR}${holder}.bin`));
}

export function loadShare(holder: ShareHolder): Keyshare {
  if (!hasShares()) throw new Error("No MPC key yet. Run `pnpm keygen` first.");
  return Keyshare.fromBytes(new Uint8Array(readFileSync(`${SHARES_DIR}${holder}.bin`)));
}

/** Addresses controlled by the 2-of-3 MPC key. */
export function mpcAddresses(publicKey: Uint8Array) {
  const btc = payments.p2wpkh({ pubkey: publicKey, network: signet });
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false);
  return {
    publicKey: bytesToHex(publicKey),
    savingsSafe: btc.address!,
    savingsSafeScript: btc.output!,
    ethereum: publicKeyToAddress(`0x${bytesToHex(uncompressed)}`),
  };
}
