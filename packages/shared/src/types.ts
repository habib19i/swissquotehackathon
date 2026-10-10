/**
 * Domain types shared by the web app and both services.
 * Keep this file free of runtime code.
 */

export type Asset = "BTC" | "USDC";
export type Pocket = "spending" | "savings";
export type Plan = "premium" | "standard";

/** Who holds each MPC share (CLAUDE.md section 5). */
export type ShareHolder = "phone" | "cosigner" | "recovery-provider";

/** A person the client can pay without Swissquote's involvement. */
export interface Contact {
  id: string;
  /** Display name shown in the UI, e.g. "Léo". Never show raw addresses on main screens. */
  name: string;
  btcAddress?: string;
  /** Checksummed 0x address on Base Sepolia. */
  ethAddress?: `0x${string}`;
}

/** The client's rules (CLAUDE.md section 6). */
export interface Rulebook {
  contacts: Contact[];
  /** Daily limit in CHF for phone-only payments (Ethereum side). Default 100. */
  dailyLimitChf: number;
  /** Target Spending pocket size in CHF (Bitcoin side). Default 100. */
  pocketSizeChf: number;
  frozen: boolean;
}

export type RulebookChange =
  | { kind: "addContact"; contact: Contact }
  | { kind: "removeContact"; contactId: string }
  | { kind: "setDailyLimit"; dailyLimitChf: number }
  | { kind: "setPocketSize"; pocketSizeChf: number }
  | { kind: "freeze" }
  | { kind: "unfreeze" };

export type ChangeDirection = "loosening" | "tightening";

export interface PendingChange {
  id: string;
  walletId: string;
  change: RulebookChange;
  direction: ChangeDirection;
  /** ISO timestamp; loosening changes only take effect after this. */
  effectiveAt: string;
  status: "pending" | "applied" | "cancelled";
}

/** Scam shield verdicts (CLAUDE.md section 9). Rule-based, never decided by AI. */
export type Verdict = "APPROVE" | "NEEDS_CONFIRMATION" | "BLOCKED";

export interface ShieldResult {
  verdict: Verdict;
  /** Plain-language reasons shown to the client. */
  reasons: string[];
  /** CHF value recomputed by the co-signer; never trust the app's number. */
  valueChf: number;
}

/** A payment draft, e.g. produced by the payment assistant or the Send screen. */
export interface PaymentDraft {
  recipientContactId: string;
  amount: string; // decimal string in the asset's unit, e.g. "0.0005" or "50"
  asset: Asset;
  pocket: Pocket;
}

export interface FeeQuote {
  paidBy: "swissquote" | "client";
  amount: string;
  asset: Asset;
}

export type RecoveryStatus =
  | "awaiting-recovery-passkey"
  | "awaiting-face-check"
  | "waiting-period"
  | "cancelled"
  | "refused"
  | "completed";

export interface RecoveryRequest {
  id: string;
  walletId: string;
  status: RecoveryStatus;
  /** ISO timestamp when the waiting period ends. */
  waitUntil?: string;
  /** Plain-language reason when refused (attacker mode shows these). */
  reason?: string;
}

export interface WalletSummary {
  walletId: string;
  plan: Plan;
  btc: { savingsAddress: string; spendingAddress: string };
  eth?: { smartAccount: `0x${string}` };
  ownershipVerified: boolean;
}
