/** Demo-only helpers. */
import { delMany } from "idb-keyval";
import { PROFILE } from "./profile";
import { RULEBOOK_CACHE } from "./rules";
import { VAULT_STORAGE_KEYS } from "./vault";
import { USDC_ACCOUNT } from "./wallet-usdc";

/** "Lose" this phone: its safe profile and encrypted share are deleted. The Swissquote login stays. */
export function forgetThisPhone() {
  return delMany([PROFILE, RULEBOOK_CACHE, USDC_ACCOUNT, ...VAULT_STORAGE_KEYS]);
}
