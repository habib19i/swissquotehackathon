/**
 * Swissquote's review of a Bitcoin spend signed with the client's MPC key, before it co-signs.
 * Everything is recomputed here: input values come from the Bitcoin network, CHF values from
 * Swissquote's own price. Nothing the app says about amounts is trusted.
 */
import { Psbt, Transaction, address as btcAddress } from "bitcoinjs-lib";
import { equalBytes } from "@noble/curves/utils.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { chfToSats, inputSighash, satsToChf, signet } from "@sqw/bitcoin";
import type { BtcReview, BtcSpendPurpose, Rulebook, WalletRecord } from "@sqw/shared";
import { formatChf } from "./format";
import { screenPayment } from "./shield";

/** A refused request: the transaction is not something Swissquote may co-sign at all. */
export class PolicyError extends Error {}

/** Above this, the network fee is treated as a mistake or an attack (about CHF 14). */
export const MAX_FEE_SATS = 20_000n;

/** Small margin over the pocket size, for price moves between the app's quote and ours. */
const POCKET_SIZE_TOLERANCE = 1.1;

export interface Prevout {
  value: bigint;
  script: Uint8Array;
}

/** A Spending pocket the client used before a recovery; the MPC key can still sweep it. */
export interface OldPocket {
  output: Uint8Array;
  witnessScript: Uint8Array;
}

export interface ReviewContext {
  wallet: WalletRecord;
  rulebook: Rulebook;
  btcChf: number;
  /** The coin an input spends, as recorded on the Bitcoin network. */
  prevout(txid: string, vout: number): Promise<Prevout>;
  /** The Spending pocket's current balance on the network. */
  pocketBalance(): Promise<bigint>;
  /** Swissquote's fee wallet: on the Premium plan one of its coins pays the network fee. */
  feeWalletAddress?: string;
  /** Pockets replaced by a recovery (only a "pocket-sweep" may spend them). */
  oldPockets?: OldPocket[];
}

export interface BtcSpendReview {
  tx: Transaction;
  prevouts: Prevout[];
  /**
   * The inputs the client's MPC key signs, with the script each signature commits to:
   * undefined for Savings safe coins (P2WPKH), the witness script for old pocket coins.
   */
  mpcInputs: Map<number, Uint8Array | undefined>;
  review: BtcReview;
}

export async function reviewBtcSpend(
  psbtBase64: string,
  purpose: BtcSpendPurpose,
  ctx: ReviewContext,
): Promise<BtcSpendReview> {
  const psbt = Psbt.fromBase64(psbtBase64, { network: signet });
  const tx = Transaction.fromBuffer(psbt.data.getTransaction());
  const savingsScript = btcAddress.toOutputScript(ctx.wallet.savingsAddress, signet);
  const feeScript = ctx.feeWalletAddress ? btcAddress.toOutputScript(ctx.feeWalletAddress, signet) : undefined;
  const sweeping = purpose === "pocket-sweep";

  const mpcInputs = new Map<number, Uint8Array | undefined>();
  const prevouts = await Promise.all(
    tx.ins.map(async (input, i) => {
      const txid = bytesToHex(Uint8Array.from(input.hash).reverse());
      const prevout = await ctx.prevout(txid, input.index);
      const oldPocket = ctx.oldPockets?.find((p) => equalBytes(p.output, prevout.script));
      if (!sweeping && equalBytes(prevout.script, savingsScript)) mpcInputs.set(i, undefined);
      else if (sweeping && oldPocket) mpcInputs.set(i, oldPocket.witnessScript);
      else if (!(feeScript && equalBytes(prevout.script, feeScript))) {
        throw new PolicyError(
          sweeping ? "Only coins in your previous Spending pocket can be moved this way." : "Only coins in your Savings safe can be moved this way.",
        );
      }
      const claimed = psbt.data.inputs[i].witnessUtxo;
      if (!claimed || claimed.value !== prevout.value || !equalBytes(claimed.script, prevout.script)) {
        throw new PolicyError("This payment does not match the Bitcoin network. Please start again.");
      }
      return prevout;
    }),
  );
  if (tx.ins.length - mpcInputs.size > 1) throw new PolicyError("A payment can use only one of Swissquote's fee coins.");

  // Swissquote's change from its fee coin is neither a recipient nor the client's money.
  const outputs = tx.outs
    .map((o) => ({ address: btcAddress.fromOutputScript(o.script, signet), value: o.value }))
    .filter((o) => o.address !== ctx.feeWalletAddress);
  const total = (list: { value: bigint }[]) => list.reduce((sum, o) => sum + o.value, 0n);
  const fee = total(prevouts) - total(tx.outs);
  if (fee < 0n) throw new PolicyError("This payment spends more than it has.");

  const toPocket = outputs.filter((o) => o.address === ctx.wallet.pocketAddress);
  const external = outputs.filter((o) => o.address !== ctx.wallet.pocketAddress && o.address !== ctx.wallet.savingsAddress);
  const feeChf = satsToChf(fee, ctx.btcChf);

  const result = (verdict: BtcReview["verdict"], valueChf: number, ...reasons: string[]): BtcSpendReview => ({
    tx,
    prevouts,
    mpcInputs,
    review: { verdict, reasons, valueChf, feeChf },
  });

  if (sweeping) {
    if (external.length > 0) throw new PolicyError("Your previous pocket can only be moved into your own safe.");
    return result("APPROVE", satsToChf(total(outputs), ctx.btcChf), "Moving your previous Spending pocket into your new one.");
  }

  if (purpose === "pocket-refill") {
    if (external.length > 0) throw new PolicyError("A refill can only go to your own Spending pocket.");
    if (toPocket.length === 0) throw new PolicyError("This refill does not pay your Spending pocket.");
    const amount = total(toPocket);
    const valueChf = satsToChf(amount, ctx.btcChf);
    if (fee > MAX_FEE_SATS) return result("BLOCKED", valueChf, "The network fee is unusually high, so Swissquote stopped this refill.");

    const pocketAfter = (await ctx.pocketBalance()) + amount;
    const pocketLimit = chfToSats(ctx.rulebook.pocketSizeChf * POCKET_SIZE_TOLERANCE, ctx.btcChf);
    if (pocketAfter > pocketLimit) {
      return result("BLOCKED", valueChf, `This would put more than ${formatChf(ctx.rulebook.pocketSizeChf)} in your Spending pocket.`);
    }
    return result("APPROVE", valueChf, "Refill of your Spending pocket from your Savings safe.");
  }

  if (toPocket.length > 0 || external.length !== 1) {
    throw new PolicyError("A payment from your Savings safe must go to exactly one recipient.");
  }
  const [recipient] = external;
  const valueChf = satsToChf(recipient.value, ctx.btcChf);
  if (fee > MAX_FEE_SATS) return result("BLOCKED", valueChf, "The network fee is unusually high, so Swissquote stopped this payment.");

  const shield = screenPayment({ address: recipient.address, valueChf, rulebook: ctx.rulebook });
  return { tx, prevouts, mpcInputs, review: { ...shield, feeChf } };
}

/** The digest Swissquote signs for one input of the client's MPC key, computed from the reviewed transaction. */
export function mpcInputDigest(spend: BtcSpendReview, inputIndex: number, mpcPublicKey: Uint8Array): Uint8Array {
  const prevout = spend.prevouts[inputIndex];
  if (!prevout) throw new PolicyError(`This payment has no input ${inputIndex}.`);
  if (!spend.mpcInputs.has(inputIndex)) throw new PolicyError("Your key only signs coins from your own safe.");
  return inputSighash(spend.tx, inputIndex, mpcPublicKey, prevout.value, spend.mpcInputs.get(inputIndex));
}
