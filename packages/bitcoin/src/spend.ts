/**
 * Builds payments from either of the client's two addresses: coin selection, change, network fee.
 * Signing happens elsewhere: with the pocket key on the phone, or with the 2-of-3 MPC key.
 */
import { Psbt, Transaction, payments, type Signer, type SignerAsync } from "bitcoinjs-lib";
import { bytesToHex } from "@noble/hashes/utils.js";
import { signet, type SavingsSafe, type SpendingPocket } from "./addresses";
import type { Utxo } from "./esplora";

/** Outputs below this are not relayed by the network; such change is left to the fee instead. */
export const DUST_SATS = 546n;

/** Conservative vbytes per input: 41 for the outpoint plus the witness. */
export const INPUT_VSIZE = {
  savings: 69, // P2WPKH: signature + public key
  pocket: 79, // P2WSH: signature + branch selector + script
};
/** 43 vbytes covers any output type (P2WSH and P2TR are the largest). */
export const OUTPUT_VSIZE = 43;
export const TX_OVERHEAD_VSIZE = 10.5;

/** Where the coins come from. */
export interface SpendSource {
  output: Uint8Array;
  witnessScript?: Uint8Array;
  inputVsize: number;
  /** Change goes back here. */
  changeAddress: string;
}

export function savingsSource(safe: SavingsSafe): SpendSource {
  return { output: safe.output, inputVsize: INPUT_VSIZE.savings, changeAddress: safe.address };
}

export function pocketSource(pocket: SpendingPocket): SpendSource {
  return {
    output: pocket.output,
    witnessScript: pocket.witnessScript,
    inputVsize: INPUT_VSIZE.pocket,
    changeAddress: pocket.address,
  };
}

export interface SpendRequest {
  source: SpendSource;
  utxos: Utxo[];
  to: string;
  /** Satoshis to send. */
  amount: bigint;
  /** sat/vB */
  feeRate: number;
}

export interface Spend {
  psbt: Psbt;
  to: string;
  amount: bigint;
  /** Total network fee of the transaction. */
  fee: bigint;
  /** The client's change, always output 1 when present. */
  change: bigint;
  /** Who pays the network fee: the client, or Swissquote's fee service (Premium plan). */
  paidBy: "client" | "swissquote";
}

export class InsufficientFundsError extends Error {
  constructor(readonly available: bigint) {
    super("Not enough bitcoin for this payment and its network fee");
  }
}

export function spendVsize(inputVsize: number, inputs: number, outputs: number): number {
  return Math.ceil(TX_OVERHEAD_VSIZE + inputVsize * inputs + OUTPUT_VSIZE * outputs);
}

function feeFor(source: SpendSource, inputs: number, outputs: number, feeRate: number): bigint {
  return BigInt(spendVsize(source.inputVsize, inputs, outputs) * feeRate);
}

/** Confirmed coins first, largest first, so payments rarely depend on unconfirmed chains. */
function spendOrder(utxos: Utxo[]): Utxo[] {
  return [...utxos].sort((a, b) => Number(b.status.confirmed) - Number(a.status.confirmed) || b.value - a.value);
}

/** Largest amount these coins can send in one payment, after the network fee. */
export function maxSpendable(source: SpendSource, utxos: Utxo[], feeRate: number): bigint {
  const total = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const max = total - feeFor(source, utxos.length, 1, feeRate);
  return max > DUST_SATS ? max : 0n;
}

export function buildSpend({ source, utxos, to, amount, feeRate }: SpendRequest): Spend {
  if (amount < DUST_SATS) throw new Error("This amount is too small to send on the Bitcoin network");

  const selected: Utxo[] = [];
  let total = 0n;
  for (const u of spendOrder(utxos)) {
    selected.push(u);
    total += BigInt(u.value);
    if (total >= amount + feeFor(source, selected.length, 2, feeRate)) break;
  }

  let fee = feeFor(source, selected.length, 2, feeRate);
  let change = total - amount - fee;
  if (change < DUST_SATS) {
    // No change output: whatever is left over goes to the network fee.
    fee = total - amount;
    change = 0n;
    if (fee < feeFor(source, selected.length, 1, feeRate)) {
      throw new InsufficientFundsError(maxSpendable(source, utxos, feeRate));
    }
  }

  const psbt = new Psbt({ network: signet });
  for (const u of selected) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: source.output, value: BigInt(u.value) },
      ...(source.witnessScript && { witnessScript: source.witnessScript }),
    });
  }
  psbt.addOutput({ address: to, value: amount });
  if (change > 0n) psbt.addOutput({ address: source.changeAddress, value: change });
  return { psbt, to, amount, fee, change, paidBy: "client" };
}

/**
 * The coins left after `spend` was broadcast as `txid`: its inputs are gone and its change output
 * (if any) is a new, unconfirmed coin. Avoids waiting for the network's index to catch up.
 */
export function coinsAfter(utxos: Utxo[], spend: Spend, txid: string): Utxo[] {
  const spent = new Set(spend.psbt.txInputs.map((i) => `${bytesToHex(Uint8Array.from(i.hash).reverse())}:${i.index}`));
  const left = utxos.filter((u) => !spent.has(`${u.txid}:${u.vout}`));
  return spend.change > 0n ? [...left, { txid, vout: 1, value: Number(spend.change), status: { confirmed: false } }] : left;
}

/**
 * Signs every input, one at a time, with a signer that may be remote (MPC: one session per input),
 * and checks each signature. The caller finalizes: savings inputs with the default finalizer,
 * pocket inputs per branch.
 */
export async function signAllInputs(
  psbt: Psbt,
  signerFor: (inputIndex: number) => Signer | SignerAsync,
  verify: (publicKey: Uint8Array, hash: Uint8Array, signature: Uint8Array) => boolean,
  options: { except?: number } = {},
) {
  for (let i = 0; i < psbt.inputCount; i++) {
    if (i === options.except) continue; // e.g. Swissquote's fee coin, signed by Swissquote itself
    await psbt.signInputAsync(i, signerFor(i));
    if (!psbt.validateSignaturesOfInput(i, verify)) throw new Error(`Signature check failed on input ${i}`);
  }
}

/**
 * The digest an MPC signature must cover for input `index`, computed from the transaction itself
 * (BIP-143). `witnessScript` is set for pocket inputs, absent for Savings safe (P2WPKH) inputs.
 */
export function inputSighash(
  tx: Transaction,
  index: number,
  publicKey: Uint8Array,
  value: bigint,
  witnessScript?: Uint8Array,
): Uint8Array {
  const scriptCode = witnessScript ?? payments.p2pkh({ pubkey: publicKey }).output!;
  return tx.hashForWitnessV0(index, scriptCode, value, Transaction.SIGHASH_ALL);
}
