/**
 * Spending pocket payments: signed on the phone with the pocket key alone.
 * The pocket's balance is the limit, since Bitcoin script cannot restrict amounts or recipients.
 */
import type { Psbt, Signer } from "bitcoinjs-lib";
import { witnessStackToScriptWitness } from "bitcoinjs-lib/src/psbt/psbtutils";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import type { SpendingPocket } from "./addresses";
import type { Utxo } from "./esplora";
import { buildSpend, maxSpendable, pocketSource, spendVsize, INPUT_VSIZE, type Spend } from "./spend";

export type PocketPayment = Spend;

export function pocketSpendVsize(inputs: number, outputs: number): number {
  return spendVsize(INPUT_VSIZE.pocket, inputs, outputs);
}

export function buildPocketPayment(req: {
  pocket: SpendingPocket;
  utxos: Utxo[];
  to: string;
  amount: bigint;
  feeRate: number;
}): PocketPayment {
  return buildSpend({ ...req, source: pocketSource(req.pocket) });
}

/** Largest amount the pocket can send in one payment, after the network fee. */
export function maxPocketAmount(pocket: SpendingPocket, utxos: Utxo[], feeRate: number): bigint {
  return maxSpendable(pocketSource(pocket), utxos, feeRate);
}

/** Which branch of the pocket script a signature uses. */
export type PocketBranch = "pocket-key" | "mpc";

/**
 * Puts the witness for the chosen branch on every pocket input: [signature, selector, script].
 * Other inputs (Swissquote's fee coin on the Premium plan) are left to their own finalizer.
 */
export function finalizePocketInputs(psbt: Psbt, branch: PocketBranch) {
  const selector = branch === "pocket-key" ? Uint8Array.of(1) : new Uint8Array(0);
  psbt.data.inputs.forEach((input, i) => {
    if (!input.witnessScript) return;
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

/**
 * Signs and finalizes the pocket inputs with the phone's pocket key. On the Premium plan the
 * transaction also holds Swissquote's fee coin, which Swissquote signs afterwards.
 */
export function signPocketInputs(psbt: Psbt, pocketSecretKey: Uint8Array) {
  const signer: Signer = {
    publicKey: secp256k1.getPublicKey(pocketSecretKey, true),
    sign: (hash) => secp256k1.sign(hash, pocketSecretKey, { prehash: false }),
  };
  psbt.signAllInputs(signer);
  const valid = psbt.data.inputs.every(
    (input, i) =>
      !input.witnessScript ||
      psbt.validateSignaturesOfInput(i, (pk, hash, sig) => secp256k1.verify(sig, hash, pk, { prehash: false })),
  );
  if (!valid) throw new Error("Pocket signature check failed");
  finalizePocketInputs(psbt, "pocket-key");
}

/** Signs a pocket-only payment and returns the raw transaction, ready to broadcast. */
export function signWithPocketKey(psbt: Psbt, pocketSecretKey: Uint8Array): { hex: string; txid: string } {
  signPocketInputs(psbt, pocketSecretKey);
  const tx = psbt.extractTransaction();
  return { hex: tx.toHex(), txid: tx.getId() };
}

export function newPocketKey(): Uint8Array {
  return secp256k1.utils.randomSecretKey();
}
