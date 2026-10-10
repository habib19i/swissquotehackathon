import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { schnorr } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import {
  DEMO_ATTACKER_BTC_ADDRESS,
  DEMO_CONTACTS,
  defaultRulebook,
  faceCheckPayload,
  rulebookChangeDigest,
  type Rulebook,
} from "@sqw/shared";
import { alerts as alertStore } from "./alerts";
import { faceChecks } from "./face-check";
import { rulebookChanges } from "./rulebook-changes";
import { MOCK_SANCTIONED_ADDRESSES } from "./shield";
import type { StoredWallet } from "./wallets";

function setup() {
  const db = new DatabaseSync(":memory:");
  let rulebook: Rulebook = { ...defaultRulebook(), contacts: DEMO_CONTACTS };
  const alerts = alertStore(db);
  const changes = rulebookChanges(db, { setRulebook: (_id, rb) => void (rulebook = rb), alerts });
  const wallet = (): StoredWallet => ({
    walletId: "w1",
    clientNumber: "CH-4417-2093",
    mpcPublicKey: "",
    pocketPublicKey: "",
    savingsAddress: "",
    pocketAddress: "",
    plan: "standard",
    rulebook,
    oldPocketKeys: [],
  });
  /** Moves a pending change's waiting period into the past. */
  const elapse = (id: string) => db.prepare("UPDATE rulebook_changes SET effective_at = ? WHERE id = ?").run(new Date(0).toISOString(), id);
  return { db, changes, alerts, wallet, rulebook: () => rulebook, elapse };
}

const thief = { id: "thief", name: "Mr. Smith", btcAddress: DEMO_ATTACKER_BTC_ADDRESS };

test("removing a contact (tightening) applies at once", () => {
  const s = setup();
  const change = s.changes.register(s.wallet(), { kind: "removeContact", contactId: "leo" }, "c1", "sig");
  assert.equal(change.status, "applied");
  assert.equal(s.rulebook().contacts.some((c) => c.id === "leo"), false);
});

test("adding a contact (loosening) waits for the delay, alerts the client, then applies", () => {
  const s = setup();
  const change = s.changes.register(s.wallet(), { kind: "addContact", contact: thief }, "c2", "sig");
  assert.equal(change.status, "pending");
  assert.ok(Date.parse(change.effectiveAt) > Date.now());
  assert.equal(s.changes.applyDue(s.wallet()).contacts.some((c) => c.id === "thief"), false, "not before the delay");
  assert.equal(s.alerts.list("w1")[0].type, "rulebook-change-requested");

  s.elapse("c2");
  assert.ok(s.changes.applyDue(s.wallet()).contacts.some((c) => c.id === "thief"));
  assert.equal(s.alerts.list("w1")[0].type, "rulebook-change-applied");
});

test("attacker mode: the real client cancels the thief's new contact during the delay", () => {
  const s = setup();
  s.changes.register(s.wallet(), { kind: "addContact", contact: thief }, "c3", "sig");
  assert.equal(s.changes.cancel(s.wallet(), "c3").status, "cancelled");
  s.elapse("c3");
  assert.equal(s.changes.applyDue(s.wallet()).contacts.some((c) => c.id === "thief"), false);
  assert.equal(s.alerts.list("w1")[0].type, "rulebook-change-cancelled");
});

test("raising the daily limit waits; lowering it is instant", () => {
  const s = setup();
  assert.equal(s.changes.register(s.wallet(), { kind: "setDailyLimit", dailyLimitChf: 500 }, "c4", "sig").status, "pending");
  assert.equal(s.changes.register(s.wallet(), { kind: "setDailyLimit", dailyLimitChf: 50 }, "c5", "sig").status, "applied");
  assert.equal(s.rulebook().dailyLimitChf, 50);
});

test("Swissquote refuses to add a sanctioned address or a duplicate contact", () => {
  const s = setup();
  const [sanctioned] = MOCK_SANCTIONED_ADDRESSES;
  assert.throws(() => s.changes.validate(s.wallet(), { kind: "addContact", contact: { id: "x", name: "X", btcAddress: sanctioned } }), /sanctions list/);
  assert.throws(() => s.changes.validate(s.wallet(), { kind: "addContact", contact: DEMO_CONTACTS[0] }), /already a contact/);
  assert.throws(() => s.changes.validate(s.wallet(), { kind: "addContact", contact: { id: "y", name: "Y", btcAddress: "nonsense" } }), /not a valid/);
});

test("the MPC key approves one exact change for one wallet", () => {
  const change = { kind: "setPocketSize", pocketSizeChf: 200 } as const;
  assert.notDeepEqual(rulebookChangeDigest("w1", change, "n1"), rulebookChangeDigest("w2", change, "n1"));
  assert.notDeepEqual(rulebookChangeDigest("w1", change, "n1"), rulebookChangeDigest("w1", change, "n2"));
});

test("Swissquote's face-check attestation verifies with its key and cannot be altered", () => {
  const db = new DatabaseSync(":memory:");
  const faces = faceChecks(db);
  const attestation = faces.issue("w1", "r1", "match");
  const digest = (a: typeof attestation) => sha256(new TextEncoder().encode(faceCheckPayload(a)));
  assert.ok(schnorr.verify(hexToBytes(attestation.signature), digest(attestation), hexToBytes(faces.publicKey)));
  const forged = { ...attestation, recoveryId: "r2" };
  assert.equal(schnorr.verify(hexToBytes(attestation.signature), digest(forged), hexToBytes(faces.publicKey)), false);
  assert.ok(faces.passed("w1", "r1"));
  faces.issue("w1", "r3", "no-match");
  assert.equal(faces.passed("w1", "r3"), false);
});
