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
  /** Plain-language relation shown under the name, e.g. "Son". */
  relation?: string;
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
  /** DeFi apps (ids from apps.ts) the passkey may use without Swissquote's co-signature. */
  apps?: string[];
  /** The apps' own daily limit in CHF (USDC leaving the safe through apps). Default 500. */
  appLimitChf?: number;
}

export type RulebookChange =
  | { kind: "addContact"; contact: Contact }
  | { kind: "removeContact"; contactId: string }
  | { kind: "setDailyLimit"; dailyLimitChf: number }
  | { kind: "setPocketSize"; pocketSizeChf: number }
  | { kind: "freeze" }
  | { kind: "unfreeze" }
  | { kind: "addApp"; appId: string }
  | { kind: "removeApp"; appId: string };

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

/** One of Swissquote's checks of a new contact, shown before Face ID. */
export interface ShieldCheck {
  label: string;
  result: "pass" | "fail" | "info";
  /** Plain language. */
  detail: string;
}

/** The scam shield's screening of a contact the client wants to add (where scams happen). */
export interface ContactScreening {
  verdict: Verdict;
  checks: ShieldCheck[];
}

export interface ShieldResult {
  verdict: Verdict;
  /** Plain-language reasons shown to the client. */
  reasons: string[];
  /** CHF value recomputed by the co-signer; never trust the app's number. */
  valueChf: number;
}

/** Where the RECOVERY passkey lives (CLAUDE.md section 5). */
export type RecoveryKeyKind = "security-key" | "synced";

export type RecoveryStatus =
  /** Started from a new phone; waits for the recovery key and Swissquote's face check. */
  | "awaiting-verification"
  /** Verified; the real client can still cancel until `waitUntil`. */
  | "waiting-period"
  | "cancelled"
  /** Refused: missing or wrong recovery key, or failed face check. */
  | "refused"
  /** Started but never verified in time. */
  | "expired"
  | "completed";

export interface RecoveryRequest {
  id: string;
  walletId: string;
  status: RecoveryStatus;
  /** ISO timestamp when the waiting period ends. */
  waitUntil?: string;
  /** Plain-language reasons when refused (attacker mode shows these). */
  reasons?: string[];
  createdAt: string;
}

/** MOCK face check: Swissquote's signed statement about a liveness check against the client's KYC photo. */
export interface FaceCheckAttestation {
  walletId: string;
  recoveryId: string;
  result: "match" | "no-match";
  at: string;
  /** Hex BIP-340 Schnorr signature by Swissquote's attestation key over the JSON of the fields above. */
  signature: string;
}
