/**
 * Bitcoin side of the app, on signet: balances, payments and pocket refills.
 *
 * - Payments up to the Spending pocket's balance: the phone alone, with the pocket key (Face ID).
 * - Larger payments: the Savings safe, signed by the phone and Swissquote after its checks.
 * - After a payment, a low pocket is refilled from the Savings safe with the same Face ID.
 * - Premium plan: Swissquote's fee service adds a coin of its own to pay the network fee.
 */
import { equalBytes } from "@noble/curves/utils.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { Psbt } from "bitcoinjs-lib";
import {
  InsufficientFundsError,
  SponsorCoinTooSmallError,
  balanceOf,
  buildSpend,
  buildSponsoredSpend,
  chfToSats,
  coinsAfter,
  esplora,
  maxPocketAmount,
  maxSavingsAmount,
  pocketSource,
  refillAmount,
  savingsSafe,
  savingsSource,
  signAllInputs,
  signPocketInputs,
  signet,
  type Balance,
  type Spend,
  type SpendSource,
  type Utxo,
} from "@sqw/bitcoin";
import { bitcoinCompact, verifyDigest, type DklsKeyshare } from "@sqw/mpc";
import { DEFAULT_POCKET_SIZE_CHF, type BtcReview, type BtcSpendPurpose, type Contact } from "@sqw/shared";
import { cosigner, cosignWithSwissquote } from "./cosigner";
import { loadDkls } from "./dkls";
import { pocketOf, type WalletProfile } from "./profile";
import { ESPLORA_URL } from "./services";
import { unlockVault } from "./vault";

const net = esplora(ESPLORA_URL);

export interface Balances {
  pocket: Balance;
  savings: Balance;
}

const safeOf = (profile: WalletProfile) => savingsSafe(hexToBytes(profile.mpcPublicKey));
const sum = (b: Balance) => b.confirmed + b.pending;

export async function loadBalances(profile: WalletProfile): Promise<Balances> {
  const [pocket, savings] = await Promise.all([net.utxos(profile.pocketAddress), net.utxos(profile.savingsAddress)]);
  return { pocket: balanceOf(pocket), savings: balanceOf(savings) };
}

/** The most each pocket can pay right now, after the network fee. */
export async function available(profile: WalletProfile) {
  const [pocketUtxos, savingsUtxos, feeRate] = await Promise.all([
    net.utxos(profile.pocketAddress),
    net.utxos(profile.savingsAddress),
    net.feeRate(),
  ]);
  return {
    pocket: maxPocketAmount(pocketOf(profile), pocketUtxos, feeRate),
    savings: maxSavingsAmount(safeOf(profile), savingsUtxos, feeRate),
  };
}

// ---------------------------------------------------------------- building

/** A transaction ready for the confirmation card. */
export interface Draft {
  spend: Spend;
  /** Premium: Swissquote's fee coin is in the transaction, as this input. */
  sponsor?: { offerId: string; inputIndex: number };
  /** Why the client pays the fee this time, in plain language (shown under the fee). */
  feeNote?: string;
}

/**
 * Builds a spend. On the Premium plan Swissquote's fee service adds one of its coins to pay the
 * fee; if Swissquote cannot (Standard plan, daily cap, unreachable), the client pays as usual.
 */
async function draft(profile: WalletProfile, source: SpendSource, utxos: Utxo[], to: string, amount: bigint): Promise<Draft> {
  const offer = await cosigner.feeOffer(profile.walletId).catch(() => undefined);
  if (offer?.sponsored) {
    try {
      const spend = buildSponsoredSpend({
        source,
        utxos,
        to,
        amount,
        sponsor: {
          coin: { ...offer.coin, status: { confirmed: true } },
          output: hexToBytes(offer.output),
          changeAddress: offer.changeAddress,
          feeRate: offer.feeRate,
        },
      });
      return { spend, sponsor: { offerId: offer.offerId, inputIndex: spend.sponsorInputIndex } };
    } catch (err) {
      if (!(err instanceof SponsorCoinTooSmallError)) throw err;
    }
  }
  const spend = buildSpend({ source, utxos, to, amount, feeRate: await net.feeRate() });
  const feeNote = offer ? (offer.sponsored ? "Swissquote's fee coin was too small this time." : offer.reason) : "Swissquote is not reachable, so you pay the network fee.";
  return { spend, feeNote };
}

/** A payment larger than either pocket can make on its own. */
export class NotEnoughInOnePocketError extends Error {
  constructor(
    readonly pocketMax: bigint,
    readonly savingsMax: bigint,
  ) {
    super("Not enough in one pocket for this payment");
  }
}

export type PreparedPayment =
  | { from: "pocket"; contact: Contact; draft: Draft }
  | { from: "savings"; contact: Contact; draft: Draft; review: BtcReview };

/**
 * Builds the payment from the right pocket, so the confirmation card shows the exact amount and fee.
 * The Spending pocket pays when it can; otherwise, or when the client asks, the Savings safe pays,
 * after Swissquote's review (scam shield, values recomputed on its side).
 */
export async function preparePayment(
  profile: WalletProfile,
  contact: Contact,
  amount: bigint,
  from?: "savings",
): Promise<PreparedPayment> {
  if (!contact.btcAddress) throw new Error(`${contact.name} has no Bitcoin address`);
  const [pocketUtxos, savingsUtxos, feeRate] = await Promise.all([
    net.utxos(profile.pocketAddress),
    net.utxos(profile.savingsAddress),
    net.feeRate(),
  ]);
  const pocket = pocketOf(profile);
  const safe = safeOf(profile);
  const pocketMax = maxPocketAmount(pocket, pocketUtxos, feeRate);
  const savingsMax = maxSavingsAmount(safe, savingsUtxos, feeRate);

  if (from !== "savings" && amount <= pocketMax) {
    return { from: "pocket", contact, draft: await draft(profile, pocketSource(pocket), pocketUtxos, contact.btcAddress, amount) };
  }
  if (amount > savingsMax) {
    if (from === "savings") throw new InsufficientFundsError(savingsMax);
    throw new NotEnoughInOnePocketError(pocketMax, savingsMax);
  }
  const built = await draft(profile, savingsSource(safe), savingsUtxos, contact.btcAddress, amount);
  const review = await cosigner.review(profile.walletId, built.spend.psbt.toBase64(), "savings-payment");
  return { from: "savings", contact, draft: built, review };
}

// ---------------------------------------------------------------- signing and broadcasting

/** Signs and finalizes the Savings safe inputs with the phone's share and Swissquote's, one MPC session each. */
async function signSavingsInputs(
  profile: WalletProfile,
  share: DklsKeyshare,
  { spend, sponsor }: Draft,
  purpose: BtcSpendPurpose,
  clientConfirmed = false,
) {
  const mpcKey = hexToBytes(profile.mpcPublicKey);
  await signAllInputs(
    spend.psbt,
    (inputIndex) => ({
      publicKey: mpcKey,
      sign: async (hash: Uint8Array) => {
        const request = { kind: "btc-input" as const, purpose, psbt: spend.psbt.toBase64(), inputIndex, clientConfirmed };
        const { r, s } = await cosignWithSwissquote(share, profile.walletId, request, hash);
        return bitcoinCompact(r, s);
      },
    }),
    (pk, hash, sig) => verifyDigest(sig, hash, pk),
    { except: sponsor?.inputIndex },
  );
  for (let i = 0; i < spend.psbt.inputCount; i++) if (i !== sponsor?.inputIndex) spend.psbt.finalizeInput(i);
}

/**
 * Broadcasts a signed transaction. On Premium, Swissquote signs its fee coin last and broadcasts the
 * transaction itself (so it only counts a fee the network accepted); it must be exactly the one built here.
 */
async function broadcast(profile: WalletProfile, { spend, sponsor }: Draft): Promise<string> {
  if (!sponsor) return net.broadcast(spend.psbt.extractTransaction().toHex());

  const { txid, psbt } = await cosigner.feeSignAndBroadcast(profile.walletId, sponsor.offerId, spend.psbt.toBase64());
  const signed = Psbt.fromBase64(psbt, { network: signet });
  if (!equalBytes(signed.data.getTransaction(), spend.psbt.data.getTransaction()) || signed.extractTransaction().getId() !== txid) {
    throw new Error("Swissquote broadcast a different transaction than the one you approved. Please contact Swissquote.");
  }
  return txid;
}

export type RefillOutcome = { txid: string; amount: bigint } | { error: string } | undefined;

export interface PaymentResult {
  txid: string;
  refill: RefillOutcome;
}

/** Unlocks the phone's secrets with one Face ID check, and wipes them after use. */
async function withSecrets<T>(profile: WalletProfile, use: (pocketKey: Uint8Array, share: DklsKeyshare) => Promise<T>): Promise<T> {
  const { pocketKey, mpcShare } = await unlockVault(profile.passkey, profile.walletId);
  const share = (await loadDkls()).Keyshare.fromBytes(mpcShare);
  try {
    return await use(pocketKey, share);
  } finally {
    pocketKey.fill(0);
    mpcShare.fill(0);
    share.free();
  }
}

/**
 * Face ID unlocks this phone's secrets once; the payment is signed and broadcast, then a low
 * Spending pocket is refilled from the Savings safe with the same unlock.
 */
export async function sendPayment(
  profile: WalletProfile,
  payment: PreparedPayment,
  btcChf: number,
  clientConfirmed = false,
): Promise<PaymentResult> {
  return withSecrets(profile, async (pocketKey, share) => {
    let [pocketCoins, savingsCoins] = await Promise.all([net.utxos(profile.pocketAddress), net.utxos(profile.savingsAddress)]);
    const { spend } = payment.draft;
    let txid: string;
    if (payment.from === "pocket") {
      signPocketInputs(spend.psbt, pocketKey);
      txid = await broadcast(profile, payment.draft);
      pocketCoins = coinsAfter(pocketCoins, spend, txid);
    } else {
      await signSavingsInputs(profile, share, payment.draft, "savings-payment", clientConfirmed);
      txid = await broadcast(profile, payment.draft);
      savingsCoins = coinsAfter(savingsCoins, spend, txid);
    }
    return { txid, refill: await refillIfLow(profile, share, pocketCoins, savingsCoins, btcChf, txid) };
  });
}

/** Tops the pocket back up to its size once it falls below half, if the Savings safe can pay for it. */
async function refillIfLow(
  profile: WalletProfile,
  share: DklsKeyshare,
  pocketCoins: Utxo[],
  utxos: Utxo[],
  btcChf: number,
  afterTxid?: string,
): Promise<RefillOutcome> {
  try {
    const sizeChf = (await cosigner.rulebook(profile.walletId)).pocketSizeChf ?? DEFAULT_POCKET_SIZE_CHF;
    const amount = refillAmount(sum(balanceOf(pocketCoins)), chfToSats(sizeChf, btcChf));
    if (amount === 0n) return undefined;
    // Swissquote checks the pocket's balance on the network: let it see the payment first.
    if (afterTxid) await net.waitForTx(afterTxid);

    const safe = safeOf(profile);
    const affordable = maxSavingsAmount(safe, utxos, await net.feeRate());
    const refill = amount < affordable ? amount : affordable;
    if (refill === 0n) return { error: "Your Savings safe is empty, so your Spending pocket was not refilled." };

    const built = await draft(profile, savingsSource(safe), utxos, profile.pocketAddress, refill);
    await signSavingsInputs(profile, share, built, "pocket-refill");
    return { txid: await broadcast(profile, built), amount: refill };
  } catch (err) {
    return { error: `Your Spending pocket could not be refilled: ${(err as Error).message}` };
  }
}

/** Refills a low pocket on request (Face ID), the same way it happens after a payment. */
export async function refillPocketNow(profile: WalletProfile, btcChf: number): Promise<RefillOutcome> {
  const [pocketCoins, savingsCoins] = await Promise.all([net.utxos(profile.pocketAddress), net.utxos(profile.savingsAddress)]);
  return withSecrets(profile, (_pocketKey, share) => refillIfLow(profile, share, pocketCoins, savingsCoins, btcChf));
}

/** Moves what is above the pocket size back to the Savings safe (pocket key only, Face ID). */
export async function moveExcessToSavings(profile: WalletProfile, amount: bigint): Promise<string> {
  const utxos = await net.utxos(profile.pocketAddress);
  const built = await draft(profile, pocketSource(pocketOf(profile)), utxos, profile.savingsAddress, amount);
  return withSecrets(profile, async (pocketKey) => {
    signPocketInputs(built.spend.psbt, pocketKey);
    return broadcast(profile, built);
  });
}

/** Unlocks the phone's share (Face ID) for a one-off MPC operation such as finishing setup. */
export function withShare<T>(profile: WalletProfile, use: (share: DklsKeyshare) => Promise<T>): Promise<T> {
  return withSecrets(profile, (_pocketKey, share) => use(share));
}
