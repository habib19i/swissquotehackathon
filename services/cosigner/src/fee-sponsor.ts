/**
 * Swissquote's check before it signs its own fee coin into a client's transaction (Premium plan).
 * Swissquote's money may pay the network fee and nothing else, within a daily cap per client.
 */
import { Transaction, type Psbt } from "bitcoinjs-lib";
import { equalBytes } from "@noble/curves/utils.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { inputIndexOf, inputVsizes, sponsoredVsize } from "@sqw/bitcoin";
import { PolicyError, type Prevout } from "./bitcoin-policy";

/** Allowed margin over the fee Swissquote offered (the app's size estimate may differ slightly). */
export const SPONSOR_FEE_TOLERANCE = 1.5;

export interface SponsorOffer {
  coin: { txid: string; vout: number; value: number };
  output: Uint8Array;
  feeRate: number;
}

export interface SponsorContext {
  prevout(txid: string, vout: number): Promise<Prevout>;
  /** Fees Swissquote already paid for this client today, in satoshis. */
  paidToday: bigint;
  dailyCap: bigint;
}

export async function checkSponsoredTx(
  psbt: Psbt,
  offer: SponsorOffer,
  ctx: SponsorContext,
): Promise<{ inputIndex: number; sponsorPays: bigint }> {
  const tx = Transaction.fromBuffer(psbt.data.getTransaction());
  const inputIndex = inputIndexOf(tx, offer.coin);
  if (inputIndex < 0) throw new PolicyError("This payment does not use Swissquote's fee coin.");

  const claimed = psbt.data.inputs[inputIndex].witnessUtxo;
  if (!claimed || claimed.value !== BigInt(offer.coin.value) || !equalBytes(claimed.script, offer.output)) {
    throw new PolicyError("This payment misdescribes Swissquote's fee coin.");
  }

  const toSwissquote = tx.outs.filter((o) => equalBytes(o.script, offer.output));
  if (toSwissquote.length !== 1) throw new PolicyError("This payment does not return Swissquote's change.");
  const sponsorPays = BigInt(offer.coin.value) - toSwissquote[0].value;
  if (sponsorPays < 0n) throw new PolicyError("This payment pays Swissquote more than its own coin.");

  // The client's coins must cover every other output: Swissquote's coin pays the fee, nothing else.
  const clientIn = await tx.ins.reduce(async (sum, input, i) => {
    if (i === inputIndex) return sum;
    const prevout = await ctx.prevout(bytesToHex(Uint8Array.from(input.hash).reverse()), input.index);
    return (await sum) + prevout.value;
  }, Promise.resolve(0n));
  const otherOut = tx.outs.reduce((sum, o) => (o === toSwissquote[0] ? sum : sum + o.value), 0n);
  if (clientIn < otherOut) {
    throw new PolicyError("This payment would use Swissquote's fee coin for more than the network fee.");
  }

  const clientVsizes = inputVsizes(psbt).filter((_, i) => i !== inputIndex);
  const offered = BigInt(Math.ceil(sponsoredVsize(clientVsizes, tx.outs.length) * offer.feeRate * SPONSOR_FEE_TOLERANCE));
  if (sponsorPays > offered) throw new PolicyError("The network fee is higher than Swissquote offered to pay.");
  if (ctx.paidToday + sponsorPays > ctx.dailyCap) {
    throw new PolicyError("You have reached today's limit of network fees paid by Swissquote.");
  }
  return { inputIndex, sponsorPays };
}
