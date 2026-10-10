/**
 * The client's RulebookAccount on Base: its settings, its counterfactual address (deployed by the
 * first UserOperation) and what is currently on-chain.
 */
import { p256 } from "@noble/curves/nist.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { encodeFunctionData, type Address, type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import type { EthAccountRecord } from "@sqw/shared";
import { factoryAbi, rulebookAccountAbi } from "./abi";
import type { BaseClient } from "./client";
import { DEPLOYMENTS } from "./deployments";

/** What the account is created with; its address commits to all of it. */
export interface AccountSettings {
  /** Ethereum address of the 2-of-3 MPC key. */
  mpcSigner: Address;
  /** The wallet passkey's P-256 public key. */
  passkeyX: Hex;
  passkeyY: Hex;
  contactsRoot: Hex;
  /** Daily limit in USDC units (6 decimals). */
  dailyLimit: bigint;
}

/** The settings of an account record (JSON form, as Swissquote keeps it). */
export const accountSettings = (record: EthAccountRecord): AccountSettings => ({
  ...record.settings,
  dailyLimit: BigInt(record.settings.dailyLimit),
});

/** The rules as currently enforced on-chain. */
export interface OnChainRules {
  deployed: boolean;
  contactsRoot: Hex;
  dailyLimit: bigint;
  frozen: boolean;
  passkeyX: Hex;
  passkeyY: Hex;
  remainingToday: bigint;
}

/** Ethereum address of the MPC key, from its compressed secp256k1 public key (hex). */
export function mpcSignerAddress(mpcPublicKey: string): Address {
  const uncompressed = secp256k1.Point.fromBytes(hexToBytes(mpcPublicKey)).toBytes(false);
  return publicKeyToAddress(`0x${bytesToHex(uncompressed)}`);
}

/** DER header of a P-256 SubjectPublicKeyInfo, up to the uncompressed point's 0x04 marker. */
const P256_SPKI_PREFIX = "3059301306072a8648ce3d020106082a8648ce3d03010703420004";

/** The passkey's public key coordinates, from the SubjectPublicKeyInfo WebAuthn returns at creation. */
export function passkeyFromSpki(spkiHex: string): { x: Hex; y: Hex } {
  const spki = spkiHex.toLowerCase();
  if (!spki.startsWith(P256_SPKI_PREFIX) || spki.length !== P256_SPKI_PREFIX.length + 128) {
    throw new Error("This passkey does not use the P-256 curve, which Base can verify.");
  }
  const point = spki.slice(P256_SPKI_PREFIX.length);
  p256.Point.fromHex(`04${point}`).assertValidity();
  return { x: `0x${point.slice(0, 64)}`, y: `0x${point.slice(64)}` };
}

const createArgs = (s: AccountSettings) => [s.mpcSigner, s.passkeyX, s.passkeyY, s.contactsRoot, s.dailyLimit] as const;

/** The factory call that deploys the account, for the first UserOperation's initCode. */
export function deployment(settings: AccountSettings): { factory: Address; factoryData: Hex } {
  return {
    factory: DEPLOYMENTS.factory,
    factoryData: encodeFunctionData({ abi: factoryAbi, functionName: "createAccount", args: createArgs(settings) }),
  };
}

export function accountAddress(client: BaseClient, settings: AccountSettings): Promise<Address> {
  return client.readContract({ address: DEPLOYMENTS.factory, abi: factoryAbi, functionName: "getAddress", args: createArgs(settings) });
}

export async function isDeployed(client: BaseClient, account: Address): Promise<boolean> {
  return Boolean(await client.getCode({ address: account }));
}

/** The account's rules on-chain; before deployment, the settings it will be created with. */
export async function onChainRules(client: BaseClient, account: Address, settings: AccountSettings): Promise<OnChainRules> {
  if (!(await isDeployed(client, account))) {
    return { deployed: false, ...settings, frozen: false, remainingToday: settings.dailyLimit };
  }
  const read = <F extends "contactsRoot" | "dailyLimit" | "frozen" | "passkeyX" | "passkeyY" | "remainingToday">(functionName: F) =>
    ({ address: account, abi: rulebookAccountAbi, functionName }) as const;
  const [contactsRoot, dailyLimit, frozen, passkeyX, passkeyY, remainingToday] = await client.multicall({
    contracts: [read("contactsRoot"), read("dailyLimit"), read("frozen"), read("passkeyX"), read("passkeyY"), read("remainingToday")],
    allowFailure: false,
  });
  return { deployed: true, contactsRoot, dailyLimit, frozen, passkeyX, passkeyY, remainingToday };
}
