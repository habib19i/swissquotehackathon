/**
 * Scam shield (CLAUDE.md section 9): Swissquote's rule-based check of a recipient and amount, and of
 * every contact the client adds (where scams happen). Rules decide; there is no AI here. Values are
 * always recomputed by Swissquote.
 */
import { address as btcAddress } from "bitcoinjs-lib";
import { isAddress } from "viem";
import { signet } from "@sqw/bitcoin";
import type { Contact, ContactScreening, Rulebook, ShieldCheck, ShieldResult } from "@sqw/shared";
import { formatChf } from "./format";

/** MOCK sanctions list (a real deployment queries a sanctions screening provider). Lower case. */
export const MOCK_SANCTIONED_ADDRESSES = new Set([
  "tb1qyeh7ezv9yqg2h0ddegk5c7468vpdfucaug4v8d",
  "0xcb32f140db63e5cc7a759e2ee152cfe648d5c67f",
]);

/** MOCK list of addresses reported as scams. Lower case. */
export const MOCK_KNOWN_SCAM_ADDRESSES = new Set([
  "tb1quxj9ersqlkrsqksh38gfjd67w3t39zd3s6xd6c",
  "0xb942dc8df503f51452a26f5a076be99a59bd4012",
]);

/** Bitcoin (bech32) and Ethereum addresses are both case-insensitive. */
const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();

export const isSanctioned = (address: string) => MOCK_SANCTIONED_ADDRESSES.has(address.toLowerCase());
export const isKnownScam = (address: string) => MOCK_KNOWN_SCAM_ADDRESSES.has(address.toLowerCase());

export interface PaymentCheck {
  address: string;
  /** CHF value computed by Swissquote, never taken from the app. */
  valueChf: number;
  rulebook: Rulebook;
}

export function screenPayment({ address, valueChf, rulebook }: PaymentCheck): ShieldResult {
  const result = (verdict: ShieldResult["verdict"], ...reasons: string[]): ShieldResult => ({
    verdict,
    reasons,
    valueChf,
  });
  const limit = formatChf(rulebook.dailyLimitChf);

  if (rulebook.frozen) {
    return result("BLOCKED", "Your safe is frozen. Unfreeze it before making payments.");
  }
  if (isSanctioned(address)) {
    return result("BLOCKED", "This address is on a sanctions list (Mock list). Swissquote cannot take part in this payment.");
  }
  if (isKnownScam(address)) {
    return result("BLOCKED", "This address has been reported as a scam (Mock list). Do not send money to it.");
  }

  const contact = rulebook.contacts.find((c) => same(c.btcAddress, address) || same(c.ethAddress, address));
  if (!contact) {
    if (valueChf > rulebook.dailyLimitChf) {
      return result(
        "BLOCKED",
        `Swissquote stops payments above ${limit} to someone you have never paid.`,
        "If you know this person, add them as a contact first. New contacts become active after a waiting period.",
      );
    }
    return result(
      "NEEDS_CONFIRMATION",
      "You have never paid this address before.",
      "Only continue if you know and trust the person you are paying. Scammers often ask for payments in crypto.",
    );
  }
  if (valueChf > rulebook.dailyLimitChf) {
    return result(
      "NEEDS_CONFIRMATION",
      `This payment is above your daily limit of ${limit}.`,
      `Please confirm that you really want to send ${formatChf(valueChf)} to ${contact.name}.`,
    );
  }
  return result("APPROVE", `${contact.name} is one of your approved contacts.`);
}

const validBitcoin = (address: string) => {
  try {
    btcAddress.toOutputScript(address, signet);
    return true;
  } catch {
    return false;
  }
};

/**
 * Swissquote's checks of a new contact, shown to the client before Face ID. Any failed check blocks
 * the contact; otherwise the client is warned and the waiting period applies.
 */
export function screenContact(contact: Pick<Contact, "name" | "btcAddress" | "ethAddress">, rulebook: Rulebook): ContactScreening {
  const checks: ShieldCheck[] = [];
  const addresses = [
    contact.btcAddress && { address: contact.btcAddress, kind: "Bitcoin", valid: validBitcoin(contact.btcAddress) },
    contact.ethAddress && { address: contact.ethAddress, kind: "digital dollar (Base)", valid: isAddress(contact.ethAddress) },
  ].filter(Boolean) as { address: string; kind: string; valid: boolean }[];

  if (addresses.length === 0) {
    checks.push({ label: "Address", result: "fail", detail: "A new contact needs a Bitcoin or a digital dollar address." });
  }
  for (const { address, kind, valid } of addresses) {
    checks.push(
      valid
        ? { label: `${kind[0].toUpperCase()}${kind.slice(1)} address`, result: "pass", detail: "A valid address on the test network." }
        : { label: `${kind[0].toUpperCase()}${kind.slice(1)} address`, result: "fail", detail: `This is not a valid ${kind} address.` },
    );
    if (!valid) continue;
    checks.push(
      isSanctioned(address)
        ? { label: "Sanctions screening (Mock list)", result: "fail", detail: "Swissquote cannot add this address: it is on a sanctions list (Mock list)." }
        : { label: "Sanctions screening (Mock list)", result: "pass", detail: "Not on any sanctions list." },
      isKnownScam(address)
        ? { label: "Reported scams (Mock list)", result: "fail", detail: "Swissquote cannot add this address: it has been reported as a scam (Mock list)." }
        : { label: "Reported scams (Mock list)", result: "pass", detail: "Nobody has reported this address as a scam." },
    );
    const owner = rulebook.contacts.find((c) => same(c.btcAddress, address) || same(c.ethAddress, address));
    if (owner) checks.push({ label: "Already a contact", result: "fail", detail: `This address already belongs to ${owner.name}.` });
  }

  const blocked = checks.some((c) => c.result === "fail");
  if (!blocked) {
    checks.push(
      {
        label: "Someone new",
        result: "info",
        detail: "You have never paid this address. Only add people you know: scammers often ask to be added as a contact.",
      },
      {
        label: "Waiting period",
        result: "info",
        detail: `For your protection, ${contact.name || "this person"} becomes a contact after a waiting period. You are alerted and can cancel it from any device.`,
      },
    );
  }
  return { verdict: blocked ? "BLOCKED" : "NEEDS_CONFIRMATION", checks };
}
