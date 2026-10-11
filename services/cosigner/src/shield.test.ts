import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_ATTACKER_BTC_ADDRESS, DEMO_ATTACKER_ETH_ADDRESS, DEMO_CONTACTS, defaultRulebook } from "@sqw/shared";
import { MOCK_KNOWN_SCAM_ADDRESSES, MOCK_SANCTIONED_ADDRESSES, screenContact, screenPayment } from "./shield";

const rulebook = { ...defaultRulebook(), contacts: DEMO_CONTACTS };
const leo = DEMO_CONTACTS[0].btcAddress!;
const [sanctioned] = MOCK_SANCTIONED_ADDRESSES;
const [scam] = MOCK_KNOWN_SCAM_ADDRESSES;

test("an approved contact within the daily limit is approved", () => {
  const r = screenPayment({ address: leo, valueChf: 50, rulebook });
  assert.equal(r.verdict, "APPROVE");
  assert.match(r.reasons[0], /Léo is one of your approved contacts/);
});

test("an approved contact above the daily limit needs an extra confirmation", () => {
  assert.equal(screenPayment({ address: leo, valueChf: 250, rulebook }).verdict, "NEEDS_CONFIRMATION");
});

test("a first-time recipient needs confirmation, with a plain-language scam warning", () => {
  const r = screenPayment({ address: DEMO_ATTACKER_BTC_ADDRESS, valueChf: 40, rulebook });
  assert.equal(r.verdict, "NEEDS_CONFIRMATION");
  assert.match(r.reasons.join(" "), /never paid this address/);
});

test("attacker mode: CHF 5,000 to the thief's own address is blocked", () => {
  const r = screenPayment({ address: DEMO_ATTACKER_BTC_ADDRESS, valueChf: 5_000, rulebook });
  assert.equal(r.verdict, "BLOCKED");
  assert.match(r.reasons[0], /never paid/);
});

test("sanctioned and reported scam addresses are blocked, whatever the amount", () => {
  assert.equal(screenPayment({ address: sanctioned, valueChf: 1, rulebook }).verdict, "BLOCKED");
  assert.equal(screenPayment({ address: scam, valueChf: 1, rulebook }).verdict, "BLOCKED");
  assert.match(screenPayment({ address: sanctioned, valueChf: 1, rulebook }).reasons[0], /sanctions list \(Mock list\)/);
});

test("a frozen safe blocks every payment, even to family", () => {
  const frozen = { ...rulebook, frozen: true };
  assert.equal(screenPayment({ address: leo, valueChf: 1, rulebook: frozen }).verdict, "BLOCKED");
});

test("the verdict carries Swissquote's own CHF value", () => {
  assert.equal(screenPayment({ address: leo, valueChf: 42.5, rulebook }).valueChf, 42.5);
});

test("USDC: contacts are recognised by their Base address, whatever its letter case", () => {
  const leoEth = DEMO_CONTACTS[0].ethAddress!;
  assert.equal(screenPayment({ address: leoEth.toLowerCase(), valueChf: 50, rulebook }).verdict, "APPROVE");
  assert.equal(screenPayment({ address: DEMO_ATTACKER_ETH_ADDRESS, valueChf: 5_000, rulebook }).verdict, "BLOCKED");
});

test("USDC: sanctioned and reported Base addresses are blocked (Mock lists)", () => {
  const ethSanctioned = [...MOCK_SANCTIONED_ADDRESSES].find((a) => a.startsWith("0x"))!;
  const ethScam = [...MOCK_KNOWN_SCAM_ADDRESSES].find((a) => a.startsWith("0x"))!;
  assert.equal(screenPayment({ address: ethSanctioned.toUpperCase().replace("0X", "0x"), valueChf: 1, rulebook }).verdict, "BLOCKED");
  assert.equal(screenPayment({ address: ethScam, valueChf: 1, rulebook }).verdict, "BLOCKED");
});

test("adding someone new: every check passes, with a scam warning and the waiting period", () => {
  const r = screenContact({ name: "Marc", ethAddress: "0x000000000000000000000000000000000000dEaD" }, rulebook);
  assert.equal(r.verdict, "NEEDS_CONFIRMATION");
  assert.deepEqual(r.checks.map((c) => c.result), ["pass", "pass", "pass", "info", "info"]);
  assert.match(r.checks.map((c) => c.detail).join(" "), /scammers often ask/);
});

test("adding a sanctioned, reported, invalid or already known address is blocked, with the reason", () => {
  const blocked = (contact: Parameters<typeof screenContact>[0], reason: RegExp) => {
    const r = screenContact(contact, rulebook);
    assert.equal(r.verdict, "BLOCKED");
    assert.match(r.checks.filter((c) => c.result === "fail").map((c) => c.detail).join(" "), reason);
  };
  blocked({ name: "X", btcAddress: sanctioned }, /sanctions list/);
  blocked({ name: "X", btcAddress: scam }, /reported as a scam/);
  blocked({ name: "X", ethAddress: "0x1234" }, /not a valid USDC/);
  blocked({ name: "X", btcAddress: leo }, /already belongs to Léo/);
  blocked({ name: "X" }, /needs a Bitcoin or a USDC address/);
});
