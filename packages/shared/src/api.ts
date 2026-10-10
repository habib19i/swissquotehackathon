/**
 * Contracts between the parts of the system. Every workstream codes against these.
 * The MPC protocol itself (keygen, sign, sealing) lives in @sqw/mpc.
 */
import type { Plan, RecoveryRequest, ShieldResult, Verdict } from "./types";

// ---------------------------------------------------------------------------
// What the phone asks a key holder to co-sign (the `request` of POST /mpc/sign).
// The holder checks it against its own rules and computes the digest itself.
// ---------------------------------------------------------------------------

export type BtcSpendPurpose = "savings-payment" | "pocket-refill";

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
  | { kind: "ownership-proof" };

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

export interface Alert {
  walletId: string;
  type:
    | "recovery-started"
    | "recovery-cancelled"
    | "recovery-completed"
    | "contact-add-requested"
    | "limit-raise-requested"
    | "change-applied"
    | "payment-blocked";
  message: string; // plain language
  at: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Independent recovery provider (services/recovery-provider). Base URL: RECOVERY_URL.
// ---------------------------------------------------------------------------

export const RECOVERY_ROUTES = {
  health: "GET /health",
  /** Register the client's RECOVERY passkey (different from the wallet passkey). */
  registerRecoveryPasskey: "POST /wallets/:walletId/recovery-passkey",
  /** Start recovery from a new phone. Returns RecoveryRequest. */
  startRecovery: "POST /wallets/:walletId/recoveries",
  /** Submit the recovery passkey assertion + Swissquote face-check attestation. */
  verifyRecovery: "POST /recoveries/:recoveryId/verify",
  /** Cancel from any device or key the real client still controls. */
  cancelRecovery: "POST /recoveries/:recoveryId/cancel",
  getRecovery: "GET /recoveries/:recoveryId",
  /** After the waiting period: run the MPC refresh with the co-signer. */
  completeRecovery: "POST /recoveries/:recoveryId/complete",
} as const;

export interface RecoveryProviderApi {
  startRecovery(walletId: string, newPhoneDeviceId: string): Promise<RecoveryRequest>;
  verifyRecovery(
    recoveryId: string,
    proof: { recoveryPasskeyAssertion: unknown; faceCheckAttestation: unknown },
  ): Promise<RecoveryRequest>;
  cancelRecovery(recoveryId: string): Promise<RecoveryRequest>;
  getRecovery(recoveryId: string): Promise<RecoveryRequest>;
  completeRecovery(recoveryId: string): Promise<RecoveryRequest>;
}
