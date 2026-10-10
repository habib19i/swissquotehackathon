/**
 * The app's client for Swissquote's co-signer. Swissquote checks and co-signs; it never holds the
 * phone's share, and the phone never signs anything it has not computed itself.
 */
import { PARTY_ID, SignParty, coordinateSign, remoteSigner, type DklsKeyshare, type Signature } from "@sqw/mpc";
import type {
  BtcReview,
  BtcSpendPurpose,
  CosignRequest,
  FeeOffer,
  Plan,
  RegisterWallet,
  Rulebook,
  WalletRecord,
} from "@sqw/shared";
import { loadDkls } from "./dkls";
import { COSIGNER_URL } from "./services";

export class CosignerError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${COSIGNER_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = res.status === 503 ? "Swissquote is not reachable right now." : (json.error ?? `Swissquote answered ${res.status}`);
    throw new CosignerError(res.status, message);
  }
  return json as T;
}

export const cosigner = {
  register: (req: RegisterWallet) => call<WalletRecord>("/wallets", req),
  wallet: (walletId: string) => call<WalletRecord>(`/wallets/${walletId}`),
  rulebook: (walletId: string) => call<Rulebook>(`/wallets/${walletId}/rulebook`),
  setPlan: (walletId: string, plan: Plan) => call<WalletRecord>(`/wallets/${walletId}/plan`, { plan }),
  review: (walletId: string, psbt: string, purpose: BtcSpendPurpose) =>
    call<BtcReview>(`/wallets/${walletId}/btc/review`, { psbt, purpose }),
  ownershipChallenge: (walletId: string) => call<{ issuedAt: string }>(`/wallets/${walletId}/ownership/challenge`, {}),
  ownershipProof: (walletId: string, signature: string) =>
    call<WalletRecord>(`/wallets/${walletId}/ownership/proof`, { signature }),
  feeOffer: (walletId: string) => call<FeeOffer>(`/wallets/${walletId}/fees/btc/offer`, {}),
  feeSignAndBroadcast: (walletId: string, offerId: string, psbt: string) =>
    call<{ txid: string; psbt: string }>(`/wallets/${walletId}/fees/btc/sign`, { offerId, psbt }),
  demoAccount: () => call<{ address: string; ready: number; waiting: number; dailyFeeCapSats: number }>("/demo/account"),
  demoCollect: () => call<{ txids: string[] }>("/demo/collect", {}),
  demoTransfer: async (walletId: string, amountChf: number, into: "savings" | "pocket") =>
    (await call<{ txid: string }>(`/wallets/${walletId}/demo/transfer`, { amountChf, into })).txid,
};

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
