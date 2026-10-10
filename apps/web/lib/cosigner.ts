/**
 * The app's client for Swissquote's co-signer. Swissquote checks and co-signs; it never holds the
 * phone's share, and the phone never signs anything it has not computed itself.
 */
import { PARTY_ID, SignParty, coordinateSign, remoteSigner, type DklsKeyshare, type Signature } from "@sqw/mpc";
import type {
  Alert,
  BtcReview,
  BtcSpendPurpose,
  ContactScreening,
  CosignRequest,
  EthAccountRecord,
  EthFeeQuote,
  EthPrepareRequest,
  EthPrepared,
  EthSent,
  EthStatus,
  FaceCheckAttestation,
  FeeOffer,
  PendingChange,
  Plan,
  RegisterWallet,
  Rulebook,
  ShieldResult,
  WalletRecord,
} from "@sqw/shared";
import { loadDkls } from "./dkls";
import { serviceClient } from "./http";
import { COSIGNER_URL } from "./services";

const call = serviceClient(COSIGNER_URL, "Swissquote");

export const cosigner = {
  health: () => call<{ offline: boolean }>("/health"),
  setOffline: (offline: boolean) => call<{ offline: boolean }>("/demo/offline", { offline }),

  register: (req: RegisterWallet) => call<WalletRecord>("/wallets", req),
  wallet: (walletId: string) => call<WalletRecord>(`/wallets/${walletId}`),
  /** MOCK login lookup: the safe of a Swissquote client, for recovery on a new phone. */
  walletOfClient: (clientNumber: string) => call<WalletRecord>(`/clients/${encodeURIComponent(clientNumber)}/wallet`),
  setPlan: (walletId: string, plan: Plan) => call<WalletRecord>(`/wallets/${walletId}/plan`, { plan }),

  rulebook: (walletId: string) => call<Rulebook>(`/wallets/${walletId}/rulebook`),
  changes: (walletId: string) => call<PendingChange[]>(`/wallets/${walletId}/rulebook/changes`),
  cancelChange: (walletId: string, changeId: string) =>
    call<PendingChange>(`/wallets/${walletId}/rulebook/changes/${changeId}/cancel`, {}),

  review: (walletId: string, psbt: string, purpose: BtcSpendPurpose) =>
    call<BtcReview>(`/wallets/${walletId}/btc/review`, { psbt, purpose }),
  /** Scam shield on an intended payment, before any transaction is built. */
  shield: (walletId: string, to: string, amountSats: bigint) =>
    call<ShieldResult>(`/wallets/${walletId}/shield/btc`, { to, amountSats: Number(amountSats) }),

  ownershipChallenge: (walletId: string) => call<{ issuedAt: string }>(`/wallets/${walletId}/ownership/challenge`, {}),
  ownershipProof: (walletId: string, signature: string) =>
    call<WalletRecord>(`/wallets/${walletId}/ownership/proof`, { signature }),

  /** MOCK face check: the app simulates the liveness result; Swissquote signs it. */
  faceCheck: (walletId: string, recoveryId: string, simulate: FaceCheckAttestation["result"]) =>
    call<FaceCheckAttestation>("/mock/face-check", { walletId, recoveryId, simulate }),
  /** After a completed recovery: the new phone's Spending pocket and wallet passkey replace the old ones. */
  recovered: (walletId: string, recoveryId: string, pocketPublicKey: string, passkeySpki?: string) =>
    call<WalletRecord>(`/wallets/${walletId}/recovered`, { recoveryId, pocketPublicKey, passkeySpki }),

  alerts: (walletId: string) => call<Alert[]>(`/wallets/${walletId}/alerts`),

  /** USDC on Base: Swissquote computes the account's address from the MPC key and the passkey. */
  registerEthereum: (walletId: string, passkeySpki: string) => call<EthAccountRecord>(`/wallets/${walletId}/ethereum`, { passkeySpki }),
  ethOwnershipChallenge: (walletId: string) => call<{ issuedAt: string }>(`/wallets/${walletId}/ethereum/ownership/challenge`, {}),
  ethOwnershipProof: (walletId: string, signature: string) =>
    call<EthAccountRecord>(`/wallets/${walletId}/ethereum/ownership/proof`, { signature }),
  ethStatus: (walletId: string) => call<EthStatus>(`/wallets/${walletId}/ethereum/status`),
  ethFee: (walletId: string) => call<EthFeeQuote>(`/wallets/${walletId}/ethereum/fee`),
  ethPrepare: (walletId: string, req: EthPrepareRequest) => call<EthPrepared>(`/wallets/${walletId}/ethereum/ops/prepare`, req),
  ethSend: (walletId: string, userOp: Record<string, string>) => call<EthSent>(`/wallets/${walletId}/ethereum/ops/send`, { userOp }),
  /** Scam shield on a contact the client wants to add, before Face ID. */
  shieldContact: (walletId: string, contact: { name: string; btcAddress?: string; ethAddress?: string }) =>
    call<ContactScreening>(`/wallets/${walletId}/shield/contact`, { contact }),
  /** Scam shield on an intended USDC payment. `amount`: USDC units. */
  shieldUsdc: (walletId: string, to: string, amount: bigint) =>
    call<ShieldResult>(`/wallets/${walletId}/shield/usdc`, { to, amount: String(amount) }),

  feeOffer: (walletId: string) => call<FeeOffer>(`/wallets/${walletId}/fees/btc/offer`, {}),
  feeSignAndBroadcast: (walletId: string, offerId: string, psbt: string) =>
    call<{ txid: string; psbt: string }>(`/wallets/${walletId}/fees/btc/sign`, { offerId, psbt }),
  demoAccount: () =>
    call<{
      address: string;
      ready: number;
      waiting: number;
      dailyFeeCapSats: number;
      /** Amounts in wei and USDC units, as decimal strings. */
      base?: { address: string; eth: string; usdc: string; paymasterDeposit: string };
    }>("/demo/account"),
  demoCollect: () => call<{ txids: string[]; usdcTxs: string[] }>("/demo/collect", {}),
  demoTransfer: async (walletId: string, amountChf: number, into: "savings" | "pocket") =>
    (await call<{ txid: string }>(`/wallets/${walletId}/demo/transfer`, { amountChf, into })).txid,
  /** MOCK "Transfer from my Swissquote account", in USDC. Returns the Base transaction hash. */
  demoTransferUsdc: async (walletId: string, amountChf: number) =>
    (await call<{ txHash: string }>(`/wallets/${walletId}/demo/transfer`, { amountChf, asset: "USDC" })).txHash,
};

/** True when Swissquote's co-signer answers and is not switched off (demo). */
export async function swissquoteOnline(): Promise<boolean> {
  return cosigner
    .health()
    .then((h) => !h.offline)
    .catch(() => false);
}

/**
 * Phone + Swissquote sign `digest` together. Swissquote computes the digest itself from `request`;
 * signing stops before any key material is used if the two do not match.
 */
export async function cosignWithSwissquote(
  share: DklsKeyshare,
  walletId: string,
  request: CosignRequest,
  digest: Uint8Array,
): Promise<Signature> {
  const lib = await loadDkls();
  const remote = remoteSigner(COSIGNER_URL, PARTY_ID.cosigner, walletId, crypto.randomUUID(), request);
  return coordinateSign(SignParty.create(lib, share), remote, digest);
}
