import { test } from "node:test";
import assert from "node:assert/strict";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { applyChange, classifyChange, contactProof, contactsRoot, defaultRulebook } from "./rulebook";
import type { Contact } from "./types";

const leo: Contact = { id: "leo", name: "Léo", ethAddress: "0x1111111111111111111111111111111111111111" };
const adam: Contact = { id: "adam", name: "Adam", ethAddress: "0x2222222222222222222222222222222222222222" };
const thief = "0x9999999999999999999999999999999999999999" as const;

test("defaults are 100 CHF daily limit and 100 CHF pocket", () => {
  const rb = defaultRulebook();
  assert.equal(rb.dailyLimitChf, 100);
  assert.equal(rb.pocketSizeChf, 100);
});

test("adding a contact and raising limits are loosening; the reverse is tightening", () => {
  const rb = defaultRulebook();
  assert.equal(classifyChange(rb, { kind: "addContact", contact: leo }), "loosening");
  assert.equal(classifyChange(rb, { kind: "setDailyLimit", dailyLimitChf: 500 }), "loosening");
  assert.equal(classifyChange(rb, { kind: "setDailyLimit", dailyLimitChf: 50 }), "tightening");
  assert.equal(classifyChange(rb, { kind: "removeContact", contactId: "leo" }), "tightening");
  assert.equal(classifyChange(rb, { kind: "freeze" }), "tightening");
});

test("proof for an approved contact verifies against the root", () => {
  const rb = applyChange(applyChange(defaultRulebook(), { kind: "addContact", contact: leo }), {
    kind: "addContact",
    contact: adam,
  });
  const root = contactsRoot(rb.contacts);
  const proof = contactProof(rb.contacts, adam.ethAddress!);
  assert.ok(StandardMerkleTree.verify(root, ["address"], [adam.ethAddress!], proof));
});

test("no proof exists for an unknown recipient (attacker mode)", () => {
  const rb = applyChange(defaultRulebook(), { kind: "addContact", contact: leo });
  assert.throws(() => contactProof(rb.contacts, thief), /not an approved contact/);
});
