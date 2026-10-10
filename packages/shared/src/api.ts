/**
 * Contracts between the parts of the system. Every workstream codes against these.
 * The MPC protocol itself (keygen, sign, sealing) lives in @sqw/mpc.
 */
import type { Plan, RulebookChange, ShieldResult, Verdict } from "./types";

// ---------------------------------------------------------------------------
// What the phone asks a key holder to co-sign (the `request` of POST /mpc/sign).
// The holder checks it against its own rules and computes the digest itself.
// ---------------------------------------------------------------------------

/** "pocket-sweep": after a recovery, the old Spending pocket is emptied into the new one with the MPC key. */
export type BtcSpendPurpose = "savings-payment" | "pocket-refill" | "pocket-sweep";

export type CosignRequest =
  | {
      kind: "btc-input";
      purpose: BtcSpendPurpose;
      /** Base64 PSBT of the whole transaction. */
      psbt: string;
      inputIndex: number;
      /** Set when the client accepted a NEEDS_CONFIRMATION verdict on the confirmation card. */
      clientConfirmed?: boolean;
    }
  | { kind: "ownership-proof" }
  /** A rulebook change; loosening changes then wait for the delay. `nonce` makes each request unique. */
  | { kind: "rulebook-change"; change: RulebookChange; nonce: string };

// ---------------------------------------------------------------------------
// Swissquote co-signer service (services/cosigner), reached at /svc/cosigner from the app.
// ---------------------------------------------------------------------------

export const COSIGNER_ROUTES = {
  health: "GET /health",
  /** Register a wallet after key generation. Body: RegisterWallet. Write-once. Returns WalletRecord. */
  registerWallet: "POST /wallets",
  getWallet: "GET /wallets/:walletId",
  getRulebook: "GET /wallets/:walletId/rulebook",
  /** Scam shield and policy check of a Bitcoin spend, before Face ID. Body: { psbt, purpose }. Returns BtcReview. */
  reviewBtcSpend: "POST /wallets/:walletId/btc/review",
  /** Start the ownership proof: Swissquote fixes the date of the message. Returns { issuedAt }. */
  ownershipChallenge: "POST /wallets/:walletId/ownership/challenge",
  /** Submit the BIP-322 signature. Body: { signature }. Swissquote verifies it and marks the safe verified. */
  ownershipProof: "POST /wallets/:walletId/ownership/proof",
  /** Premium: Swissquote offers one of its coins to pay the network fee. Returns FeeOffer. */
  feeOffer: "POST /wallets/:walletId/fees/btc/offer",
  /** Premium: Swissquote checks the final transaction, signs its fee coin and broadcasts it. Body: { offerId, psbt }. Returns { txid, psbt }. */
  feeSign: "POST /wallets/:walletId/fees/btc/sign",
  /** Demo: Swissquote's operational wallet (Premium fees, mock Swissquote account): address and balance. */
  demoAccount: "GET /demo/account",
  /** Demo: collect the mock family's test coins back into Swissquote's wallet. */
  demoCollect: "POST /demo/collect",
  /** MOCK "Transfer from my Swissquote account". Body: { amountChf, into: "savings" | "pocket" }. Returns { txid }. */
  demoTransfer: "POST /wallets/:walletId/demo/transfer",
  /** Change the plan (demo settings). Body: { plan }. */
  setPlan: "POST /wallets/:walletId/plan",
  /** Request a rulebook change. Body: RulebookChange. Runs the scam shield on new contacts. Returns PendingChange. (M3) */
  requestChange: "POST /wallets/:walletId/rulebook/changes",
  /** Cancel a pending loosening change. (M3) */
  cancelChange: "POST /wallets/:walletId/rulebook/changes/:changeId/cancel",
  /** MOCK face check / KYC attestation used by recovery. Returns a signed attestation. (M3) */
  faceCheck: "POST /mock/face-check",
  /** Demo switch: when offline, every route except /health and /demo/* returns 503. */
  setOffline: "POST /demo/offline",
  /** WebSocket stream of alerts (Watcher). */
  alerts: "WS /alerts",
} as const;

export interface RegisterWallet {
  walletId: string;
  clientNumber: string;
  /** Compressed public key of the phone's Spending pocket key (hex). */
  pocketPublicKey: string;
  plan: Plan;
}

/** Swissquote's view of a wallet. Addresses are computed by Swissquote from the public keys. */
export interface WalletRecord {
  walletId: string;
  clientNumber: string;
  mpcPublicKey: string;
  pocketPublicKey: string;
  savingsAddress: string;
  pocketAddress: string;
  plan: Plan;
  /** ISO timestamp of the verified BIP-322 ownership proof (Travel Rule). */
  ownershipVerifiedAt?: string;
}

/**
 * Premium plan: Swissquote's offer to pay the network fee with one coin of its own
 * (POST /wallets/:walletId/fees/btc/offer). The coin is reserved for a few minutes.
 */
export type FeeOffer =
  | {
      sponsored: true;
      offerId: string;
      coin: { txid: string; vout: number; value: number };
      /** Hex scriptPubKey of Swissquote's fee wallet; its change goes to `changeAddress`. */
      output: string;
      changeAddress: string;
      /** sat/vB */
      feeRate: number;
    }
  | { sponsored: false; reason: string };

/** Swissquote's check of a Bitcoin spend: values recomputed from the network and its own price. */
export interface BtcReview extends ShieldResult {
  verdict: Verdict;
  /** Network fee in CHF, recomputed by Swissquote. */
  feeChf: number;
}

export type AlertType =
  | "recovery-started"
  | "recovery-cancelled"
  | "recovery-refused"
  | "recovery-completed"
  | "rulebook-change-requested"
  | "rulebook-change-cancelled"
  | "rulebook-change-applied"
  | "payment-blocked";

/** The Watcher's alerts, sent on every channel (mocked on screen). */
export interface Alert {
  id: number;
  walletId: string;
  type: AlertType;
  /** Plain language. */
  message: string;
  at: string;
  /** For alerts the client can act on: the change or recovery to cancel. */
  changeId?: string;
  recoveryId?: string;
}

// ---------------------------------------------------------------------------
// Independent recovery provider (services/recovery-provider), reached at /svc/recovery from the app.
// ---------------------------------------------------------------------------

export const RECOVERY_ROUTES = {
  health: "GET /health",
  /** Registration options for the RECOVERY passkey. Body: { clientNumber, kind }. */
  recoveryKeyOptions: "POST /wallets/:walletId/recovery-key/options",
  /** Register the RECOVERY passkey (WebAuthn registration response). Write-once. */
  registerRecoveryKey: "POST /wallets/:walletId/recovery-key",
  getRecoveryKey: "GET /wallets/:walletId/recovery-key",
  /** Start recovery from a new phone. Returns { recovery, options } (WebAuthn options for the recovery key). */
  startRecovery: "POST /wallets/:walletId/recoveries",
  /** Recovery key assertion + Swissquote's face-check attestation. Both valid: the waiting period starts. */
  verifyRecovery: "POST /recoveries/:recoveryId/verify",
  /** Cancel during the waiting period, from any device the real client still controls. */
  cancelRecovery: "POST /recoveries/:recoveryId/cancel",
  getRecovery: "GET /recoveries/:recoveryId",
  /** Swissquote offline: WebAuthn options so the recovery key approves a phone + provider signature. */
  offlineApproval: "POST /wallets/:walletId/offline-approval",
} as const;
