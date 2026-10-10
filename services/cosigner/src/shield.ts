/**
 * Scam shield (CLAUDE.md section 9): Swissquote's rule-based check of a recipient and amount.
 * Rules decide; there is no AI here. Values are always recomputed by Swissquote.
 */
import type { Rulebook, ShieldResult } from "@sqw/shared";
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
