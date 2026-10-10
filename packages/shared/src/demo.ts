/**
 * Demo data (MOCK). The client's family, as if imported from their Swissquote account's saved
 * beneficiaries. Signet addresses are test-only; nobody holds their keys, so payments to them are final.
 */
import type { Contact } from "./types";

export const DEMO_CONTACTS: Contact[] = [
  { id: "leo", name: "Léo", relation: "Son", btcAddress: "tb1qlq2jjz3690pnygrytqptyy4rhterj4rswsw8pd" },
  { id: "adam", name: "Adam", relation: "Son", btcAddress: "tb1q5ahha6rlazur7syxwhqd0e679u46l7qqn0wf07" },
  { id: "sofia", name: "Sofia", relation: "Daughter", btcAddress: "tb1qwj474rgnasck7emwwjl60tsk7fgft9vc5d2z2j" },
];

/** MOCK Swissquote client, already KYC-verified (CLAUDE.md section 8). */
export const DEMO_CLIENT = { name: "Elisabeth Keller", clientNumber: "CH-4417-2093" };
