/**
 * Demo data (MOCK). The client's family, as if imported from their Swissquote account's saved
 * beneficiaries. Their signet and Base Sepolia wallets are mock wallets held by the co-signer's demo
 * account (one key each, derived from the public label `swissquote-wallet-demo-family/<id>`), which
 * collects what they receive so test coins keep circulating during the demo.
 */
import type { Contact } from "./types";

export const DEMO_CONTACTS: Contact[] = [
  {
    id: "leo",
    name: "Léo",
    relation: "Son",
    btcAddress: "tb1qppv822ua5jp0nxmkz445a63rkd0gn4s0m4mldf",
    ethAddress: "0x5075c73f1D8Ca3859054EF11fbFfa58fa9b6E717",
  },
  {
    id: "adam",
    name: "Adam",
    relation: "Son",
    btcAddress: "tb1qv5u40dleu0qj6309g5w2ej5keqk4228f9cpwzx",
    ethAddress: "0xFDfb1Ccef456760d080b76cBE031Cac8F11F3a74",
  },
  {
    id: "sofia",
    name: "Sofia",
    relation: "Daughter",
    btcAddress: "tb1qhhj9vwat758xggtjyhhq8fmpc7cqzq7y0ac98x",
    ethAddress: "0x59D86517Cc5d8aa6E9CcFb293beD82687Df56739",
  },
];

/** Label from which the mock family wallets' test keys are derived (public on purpose). */
export const DEMO_FAMILY_KEY_LABEL = "swissquote-wallet-demo-family/";

/** Attacker mode (CLAUDE.md section 8): the thief's own address. Not an approved contact. */
export const DEMO_ATTACKER_BTC_ADDRESS = "tb1qc64spgn84q8x2mckcjn5l4lqtena67aqaedy2k";
export const DEMO_ATTACKER_ETH_ADDRESS: `0x${string}` = "0xE2a0455E058a23E152C18f56103c99522554867f";

/** MOCK Swissquote client, already KYC-verified (CLAUDE.md section 8). */
export const DEMO_CLIENT = { name: "Elisabeth Keller", clientNumber: "CH-4417-2093" };
