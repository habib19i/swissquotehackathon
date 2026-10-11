/**
 * The web app's `idb-keyval` storage, kept by the iOS app instead (public data only: the safe's profile,
 * the rulebook cache, the USDC account record). Deleting the vault key forgets the phone's secrets and
 * its Face ID key, as "Lose this phone" does in the web app.
 */
import { native } from "../bridge";
import { decodeStored, encodeStored } from "../serialize";
import { VAULT_KEY } from "./vault";

export async function get<T>(key: string): Promise<T | undefined> {
  const { value } = await native<{ value: string | null }>("storage.get", { key });
  return value === null ? undefined : decodeStored<T>(value);
}

export async function set(key: string, value: unknown): Promise<void> {
  await native("storage.set", { key, value: encodeStored(value) });
}

export async function del(key: string): Promise<void> {
  await native(key === VAULT_KEY ? "device.forget" : "storage.del", { key });
}

export async function delMany(keys: string[]): Promise<void> {
  for (const key of keys) await del(key);
}
