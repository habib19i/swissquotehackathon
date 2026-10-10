/** Demo-only helpers. */
import { delMany } from "idb-keyval";
import { PROFILE } from "./profile";
import { RULEBOOK_CACHE } from "./rules";
import { VAULT_STORAGE_KEYS } from "./vault";

/** "Lose" this phone: its safe profile and encrypted share are deleted. The Swissquote login stays. */
export function forgetThisPhone() {
  return delMany([PROFILE, RULEBOOK_CACHE, ...VAULT_STORAGE_KEYS]);
}
