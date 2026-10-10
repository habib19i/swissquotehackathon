/**
 * Contracts between the parts of the system. Every workstream codes against these.
 * The real MPC library and MockMPC must both implement `MpcParty`.
 */
import type {
  FeeQuote,
  PaymentDraft,
  PendingChange,
  Plan,
  RecoveryRequest,
  Rulebook,
  RulebookChange,
  ShareHolder,
  ShieldResult,
} from "./types";

// ---------------------------------------------------------------------------
// MPC (CLAUDE.md sections 5 and 11). Same API for the real library and MockMPC.
// ---------------------------------------------------------------------------

export type Curve = "secp256k1";

export interface KeygenResult {
  walletId: string;
  /** Compressed secp256k1 public key, hex. Used for the Bitcoin Savings safe and as the Ethereum MPC admin. */
  publicKey: string;
  holder: ShareHolder;
}

export interface SignRequest {
  walletId: string;
  /** 32-byte digest to sign, hex (Bitcoin sighash or Ethereum hash). */
  digest: string;
  /** The two holders taking part in this signature. */
  parties: [ShareHolder, ShareHolder];
  /** Why this signature is needed; services refuse unknown purposes. */
  purpose: "savings-payment" | "pocket-refill" | "rulebook-change" | "ownership-proof";
}

export interface SignResult {
  /** DER or compact signature, hex, depending on the chain adapter. */
  signature: string;
}

export interface RefreshRequest {
  walletId: string;
  /** Holders running the refresh; recovery uses ["cosigner", "recovery-provider"]. */
  parties: [ShareHolder, ShareHolder];
  /** Receives the new share 1. */
  newPhoneDeviceId: string;
}

export interface MpcParty {
  keygen(walletId: string): Promise<KeygenResult>;
  sign(req: SignRequest): Promise<SignResult>;
  refresh(req: RefreshRequest): Promise<{ ok: true }>;
}

// ---------------------------------------------------------------------------
// Swissquote co-signer service (services/cosigner). Base URL: COSIGNER_URL.
// ---------------------------------------------------------------------------

export const COSIGNER_ROUTES = {
  health: "GET /health",
  /** Scam shield on a payment outside the rules. Body: PaymentDraft. Returns ShieldResult. */
  checkPayment: "POST /shield/payment",
  /** Request a rulebook change. Body: RulebookChange. Runs the scam shield on new contacts. Returns PendingChange. */
  requestChange: "POST /wallets/:walletId/rulebook/changes",
  /** Cancel a pending loosening change. */
  cancelChange: "POST /wallets/:walletId/rulebook/changes/:changeId/cancel",
  getRulebook: "GET /wallets/:walletId/rulebook",
  /** Fee quote for a payment given the client's plan. Body: PaymentDraft. Returns FeeQuote. */
  feeQuote: "POST /fees/quote",
  /** MOCK face check / KYC attestation used by recovery. Returns a signed attestation. */
  faceCheck: "POST /mock/face-check",
  /** Demo switch: when offline, every route except /health and /demo/* returns 503. */
  setOffline: "POST /demo/offline",
  /** WebSocket stream of alerts (Watcher). */
  alerts: "WS /alerts",
} as const;

export interface CosignerApi {
  checkPayment(walletId: string, draft: PaymentDraft): Promise<ShieldResult>;
  requestChange(walletId: string, change: RulebookChange): Promise<PendingChange>;
  cancelChange(walletId: string, changeId: string): Promise<PendingChange>;
  getRulebook(walletId: string): Promise<Rulebook>;
  feeQuote(walletId: string, plan: Plan, draft: PaymentDraft): Promise<FeeQuote>;
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
