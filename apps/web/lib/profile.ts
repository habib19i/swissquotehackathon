/**
 * What this phone remembers about the client's safe. Public information only; secrets live in vault.ts.
 */
import { del, get, set } from "idb-keyval";
import { hexToBytes } from "@noble/hashes/utils.js";
import { spendingPocket } from "@sqw/bitcoin";
import type { WalletPasskey } from "./passkey";

export interface Client {
  name: string;
  clientNumber: string;
}

export interface WalletProfile {
  walletId: string;
  client: Client;
  /** Compressed secp256k1 public key of the 2-of-3 MPC key (hex). */
  mpcPublicKey: string;
  /** Compressed public key of the phone's Spending pocket key (hex). */
  pocketPublicKey: string;
  savingsAddress: string;
  pocketAddress: string;
  passkey: WalletPasskey;
  createdAt: string;
}

const PROFILE = "sqw.profile";
const CLIENT = "sqw.client";

export const loadProfile = () => get<WalletProfile>(PROFILE);
export const saveProfile = (profile: WalletProfile) => set(PROFILE, profile);

/** MOCK Swissquote login session. */
export const loadClient = () => get<Client>(CLIENT);
export const saveClient = (client: Client) => set(CLIENT, client);
export const logout = () => del(CLIENT);

export function pocketOf(profile: WalletProfile) {
  return spendingPocket(hexToBytes(profile.pocketPublicKey), hexToBytes(profile.mpcPublicKey));
}
