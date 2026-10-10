/**
 * Premium plan (CLAUDE.md section 7): Swissquote's fee service adds one coin of its own to pay the
 * network fee, and both parties sign the same final transaction. The client's coins cover exactly
 * the amount; Swissquote's coin covers the fee and its change goes back to Swissquote.
 */
import { Psbt, type Transaction } from "bitcoinjs-lib";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signet } from "./addresses";
import type { Utxo } from "./esplora";
import {
  DUST_SATS,
  INPUT_VSIZE,
  InsufficientFundsError,
  OUTPUT_VSIZE,
  TX_OVERHEAD_VSIZE,
  type Spend,
  type SpendSource,
} from "./spend";

/** Swissquote's offer: one coin from its fee wallet, at a fee rate it chose. */
export interface FeeSponsor {
  coin: Utxo;
  /** scriptPubKey of Swissquote's fee wallet (P2WPKH). */
  output: Uint8Array;
  /** Swissquote's change goes back here. */
  changeAddress: string;
  /** sat/vB */
  feeRate: number;
}

/** Virtual size of a sponsored spend: the client's inputs, Swissquote's P2WPKH input, the outputs. */
export function sponsoredVsize(clientInputVsizes: number[], outputs: number): number {
  const inputs = clientInputVsizes.reduce((a, b) => a + b, 0) + INPUT_VSIZE.savings;
  return Math.ceil(TX_OVERHEAD_VSIZE + inputs + OUTPUT_VSIZE * outputs);
}

/** Vbytes of each input of an existing transaction: pocket inputs carry a witness script. */
export function inputVsizes(psbt: Psbt): number[] {
  return psbt.data.inputs.map((i) => (i.witnessScript ? INPUT_VSIZE.pocket : INPUT_VSIZE.savings));
}

export class SponsorCoinTooSmallError extends Error {
  constructor() {
    super("Swissquote's fee coin is too small for this payment");
  }
}

export function buildSponsoredSpend(req: {
  source: SpendSource;
  utxos: Utxo[];
  to: string;
  amount: bigint;
  sponsor: FeeSponsor;
}): Spend & { sponsorInputIndex: number } {
  const { source, utxos, to, amount, sponsor } = req;
  if (amount < DUST_SATS) throw new Error("This amount is too small to send on the Bitcoin network");

  // The client's coins only need to cover the amount itself.
  const selected: Utxo[] = [];
  let total = 0n;
  for (const u of [...utxos].sort((a, b) => Number(b.status.confirmed) - Number(a.status.confirmed) || b.value - a.value)) {
    if (total >= amount) break;
    selected.push(u);
    total += BigInt(u.value);
  }
  if (total < amount) throw new InsufficientFundsError(total);

  // Change below dust cannot be an output; it joins the fee, the only part the client pays.
  const change = total - amount >= DUST_SATS ? total - amount : 0n;
  const clientLeftover = total - amount - change;

  const outputs = 1 + (change > 0n ? 1 : 0) + 1; // recipient, client change, Swissquote's change
  const vsize = sponsoredVsize(selected.map(() => source.inputVsize), outputs);
  const fee = BigInt(vsize * sponsor.feeRate);
  const sponsorPays = fee > clientLeftover ? fee - clientLeftover : 0n;
  const sponsorChange = BigInt(sponsor.coin.value) - sponsorPays;
  if (sponsorChange < DUST_SATS) throw new SponsorCoinTooSmallError();

  const psbt = new Psbt({ network: signet });
  for (const u of selected) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: source.output, value: BigInt(u.value) },
      ...(source.witnessScript && { witnessScript: source.witnessScript }),
    });
  }
  psbt.addInput({
    hash: sponsor.coin.txid,
    index: sponsor.coin.vout,
    witnessUtxo: { script: sponsor.output, value: BigInt(sponsor.coin.value) },
  });
  psbt.addOutput({ address: to, value: amount });
  if (change > 0n) psbt.addOutput({ address: source.changeAddress, value: change });
  psbt.addOutput({ address: sponsor.changeAddress, value: sponsorChange });

  return {
    psbt,
    to,
    amount,
    fee: clientLeftover + sponsorPays,
    change,
    paidBy: "swissquote",
    sponsorInputIndex: selected.length,
  };
}

/** Index of the input spending `coin`, or -1. */
export function inputIndexOf(tx: Transaction, coin: { txid: string; vout: number }): number {
  return tx.ins.findIndex(
    (i) => bytesToHex(Uint8Array.from(i.hash).reverse()) === coin.txid && i.index === coin.vout,
  );
}
