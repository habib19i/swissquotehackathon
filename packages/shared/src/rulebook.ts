/**
 * Rulebook helpers (CLAUDE.md section 6).
 * The Merkle tree uses OpenZeppelin's StandardMerkleTree so proofs verify with
 * OpenZeppelin's MerkleProof library in the Solidity validation module.
 */
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { sha256 } from "@noble/hashes/sha2.js";
import type { ChangeDirection, Contact, Rulebook, RulebookChange } from "./types";

export const DEFAULT_DAILY_LIMIT_CHF = 100;
export const DEFAULT_POCKET_SIZE_CHF = 100;

export function defaultRulebook(): Rulebook {
  return {
    contacts: [],
    dailyLimitChf: DEFAULT_DAILY_LIMIT_CHF,
    pocketSizeChf: DEFAULT_POCKET_SIZE_CHF,
    frozen: false,
  };
}

/** Leaf encoding shared with the Solidity module: abi.encode(address). */
const LEAF_ENCODING = ["address"];

function approvedEthAddresses(contacts: Contact[]): `0x${string}`[] {
  return contacts.flatMap((c) => (c.ethAddress ? [c.ethAddress] : []));
}

/** Builds the approved-contacts tree. Returns null when there are no Ethereum contacts. */
export function buildContactsTree(contacts: Contact[]) {
  const leaves = approvedEthAddresses(contacts).map((a) => [a]);
  if (leaves.length === 0) return null;
  return StandardMerkleTree.of(leaves, LEAF_ENCODING);
}

export function contactsRoot(contacts: Contact[]): `0x${string}` {
  const tree = buildContactsTree(contacts);
  return (tree?.root ?? `0x${"0".repeat(64)}`) as `0x${string}`;
}

/** Proof that `address` is an approved contact; throws if it is not. */
export function contactProof(contacts: Contact[], address: `0x${string}`): `0x${string}`[] {
  const tree = buildContactsTree(contacts);
  if (!tree) throw new Error("No approved contacts");
  for (const [i, [leaf]] of tree.entries()) {
    if (String(leaf).toLowerCase() === address.toLowerCase()) {
      return tree.getProof(i) as `0x${string}`[];
    }
  }
  throw new Error("Recipient is not an approved contact");
}

/**
 * Loosening changes need the MPC key + a delay; tightening changes are instant.
 * Compared against the current rulebook so that e.g. setting a lower limit is tightening.
 */
export function classifyChange(current: Rulebook, change: RulebookChange): ChangeDirection {
  switch (change.kind) {
    case "addContact":
    case "unfreeze":
      return "loosening";
    case "removeContact":
    case "freeze":
      return "tightening";
    case "setDailyLimit":
      return change.dailyLimitChf > current.dailyLimitChf ? "loosening" : "tightening";
    case "setPocketSize":
      return change.pocketSizeChf > current.pocketSizeChf ? "loosening" : "tightening";
  }
}

export function applyChange(current: Rulebook, change: RulebookChange): Rulebook {
  switch (change.kind) {
    case "addContact":
      return { ...current, contacts: [...current.contacts, change.contact] };
    case "removeContact":
      return { ...current, contacts: current.contacts.filter((c) => c.id !== change.contactId) };
    case "setDailyLimit":
      return { ...current, dailyLimitChf: change.dailyLimitChf };
    case "setPocketSize":
      return { ...current, pocketSizeChf: change.pocketSizeChf };
    case "freeze":
      return { ...current, frozen: true };
    case "unfreeze":
      return { ...current, frozen: false };
  }
}

/**
 * What the MPC key signs to approve a rulebook change: bound to one wallet and one request (`nonce`,
 * which is also the change's id). The phone and Swissquote compute it independently.
 */
export function rulebookChangeDigest(walletId: string, change: RulebookChange, nonce: string): Uint8Array {
  return sha256(new TextEncoder().encode(JSON.stringify(["swissquote-rulebook-change-v1", walletId, change, nonce])));
}
