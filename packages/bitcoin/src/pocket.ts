/**
 * Spending pocket payments: built here, signed on the phone with the pocket key alone.
 * The pocket's balance is the limit, since Bitcoin script cannot restrict amounts or recipients.
 */
import { Psbt, type Signer } from "bitcoinjs-lib";
import { witnessStackToScriptWitness } from "bitcoinjs-lib/src/psbt/psbtutils";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { signet, type SpendingPocket } from "./addresses";
import type { Utxo } from "./esplora";

/** Outputs below this are not relayed by the network; such change is left to the fee instead. */
export const DUST_SATS = 546n;

/**
 * Conservative virtual size of a pocket spend, in vbytes.
 * Pocket input: 41 vB outpoint + ~37.25 vB witness (signature, branch selector, script).
 * Outputs: 43 vB covers any address type (P2WSH / P2TR are the largest).
 */
export function pocketSpendVsize(inputs: number, outputs: number): number {
  return Math.ceil(10.5 + 79 * inputs + 43 * outputs);
}

export interface PocketPaymentRequest {
  pocket: SpendingPocket;
  utxos: Utxo[];
  to: string;
  /** Satoshis to send. */
  amount: bigint;
  /** sat/vB */
  feeRate: number;
}

export interface PocketPayment {
  psbt: Psbt;
  amount: bigint;
  fee: bigint;
  change: bigint;
}

export class InsufficientFundsError extends Error {
  constructor(readonly available: bigint) {
    super("Not enough in the Spending pocket for this payment and its network fee");
  }
}

/** Confirmed coins first, largest first, so payments rarely depend on unconfirmed chains. */
function spendOrder(utxos: Utxo[]): Utxo[] {
  return [...utxos].sort(
    (a, b) => Number(b.status.confirmed) - Number(a.status.confirmed) || b.value - a.value,
  );
}

function feeFor(inputs: number, outputs: number, feeRate: number): bigint {
  return BigInt(pocketSpendVsize(inputs, outputs) * feeRate);
}

/** Largest amount the pocket can send in one payment, after the network fee. */
export function maxPocketAmount(utxos: Utxo[], feeRate: number): bigint {
  const total = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const max = total - feeFor(utxos.length, 1, feeRate);
  return max > DUST_SATS ? max : 0n;
}

export function buildPocketPayment({ pocket, utxos, to, amount, feeRate }: PocketPaymentRequest): PocketPayment {
  if (amount < DUST_SATS) throw new Error("This amount is too small to send on the Bitcoin network");

  const selected: Utxo[] = [];
  let total = 0n;
  for (const u of spendOrder(utxos)) {
    selected.push(u);
    total += BigInt(u.value);
    if (total >= amount + feeFor(selected.length, 2, feeRate)) break;
  }

  let fee = feeFor(selected.length, 2, feeRate);
  let change = total - amount - fee;
  if (change < DUST_SATS) {
    // No change output: whatever is left over goes to the network fee.
    fee = total - amount;
    change = 0n;
    if (fee < feeFor(selected.length, 1, feeRate)) throw new InsufficientFundsError(maxPocketAmount(utxos, feeRate));
  }

  const psbt = new Psbt({ network: signet });
  for (const u of selected) {
    psbt.addInput({
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: pocket.output, value: BigInt(u.value) },
      witnessScript: pocket.witnessScript,
    });
  }
  psbt.addOutput({ address: to, value: amount });
  if (change > 0n) psbt.addOutput({ address: pocket.address, value: change });
  return { psbt, amount, fee, change };
}

/** Which branch of the pocket script a signature uses. */
export type PocketBranch = "pocket-key" | "mpc";

/** Puts the witness for the chosen branch: [signature, selector, script]. */
export function finalizePocketInputs(psbt: Psbt, branch: PocketBranch) {
  const selector = branch === "pocket-key" ? Uint8Array.of(1) : new Uint8Array(0);
  psbt.data.inputs.forEach((input, i) => {
    psbt.finalizeInput(i, () => {
      const [sig] = input.partialSig ?? [];
      if (!sig || !input.witnessScript) throw new Error(`Pocket input ${i} is not signed`);
      return {
        finalScriptSig: undefined,
        finalScriptWitness: witnessStackToScriptWitness([sig.signature, selector, input.witnessScript]),
      };
    });
  });
}

/** Signs every input with the phone's pocket key and returns the raw transaction, ready to broadcast. */
export function signWithPocketKey(psbt: Psbt, pocketSecretKey: Uint8Array): { hex: string; txid: string } {
  const signer: Signer = {
    publicKey: secp256k1.getPublicKey(pocketSecretKey, true),
    sign: (hash) => secp256k1.sign(hash, pocketSecretKey, { prehash: false }),
  };
  psbt.signAllInputs(signer);
  const valid = psbt.data.inputs.every((_, i) =>
    psbt.validateSignaturesOfInput(i, (pk, hash, sig) => secp256k1.verify(sig, hash, pk, { prehash: false })),
  );
  if (!valid) throw new Error("Pocket signature check failed");
  finalizePocketInputs(psbt, "pocket-key");
  const tx = psbt.extractTransaction();
  return { hex: tx.toHex(), txid: tx.getId() };
}

export function newPocketKey(): Uint8Array {
  return secp256k1.utils.randomSecretKey();
}
