import { test } from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bitcoinCompact, verifyDigest } from "@sqw/mpc";
import { keygen, sign } from "@sqw/mpc/node";
import { savingsSafe, spendingPocket } from "./addresses";
import type { Utxo } from "./esplora";
import {
  encodeOwnershipProof,
  ownershipDigest,
  ownershipMessage,
  ownershipToSign,
  verifyOwnershipProof,
} from "./ownership";
import { buildPocketPayment, newPocketKey } from "./pocket";
import { buildSavingsPayment, refillAmount } from "./savings";
import { coinsAfter, inputSighash, signAllInputs } from "./spend";

const [phone, cosigner] = keygen();
const mpcKey = phone.publicKey;
const safe = savingsSafe(mpcKey);
const pocket = spendingPocket(secp256k1.getPublicKey(newPocketKey(), true), mpcKey);
const leo = "tb1qlq2jjz3690pnygrytqptyy4rhterj4rswsw8pd";

const utxo = (value: number, n = 0): Utxo => ({
  txid: n.toString(16).padStart(64, "b"),
  vout: n,
  value,
  status: { confirmed: true },
});

/** MPC signer that also records the hash bitcoinjs asked it to sign. */
function mpcSigner(seen: Uint8Array[] = []) {
  return {
    publicKey: mpcKey,
    sign: async (hash: Uint8Array) => {
      seen.push(hash);
      const { r, s } = sign([phone, cosigner], hash);
      return bitcoinCompact(r, s);
    },
  };
}
const verify = (pk: Uint8Array, hash: Uint8Array, sig: Uint8Array) => verifyDigest(sig, hash, pk);

test("a Savings safe payment is signed input by input with the MPC key", async () => {
  const spend = buildSavingsPayment({ safe, utxos: [utxo(60_000, 1), utxo(50_000, 2)], to: leo, amount: 100_000n, feeRate: 2 });
  assert.equal(spend.psbt.inputCount, 2);
  await signAllInputs(spend.psbt, () => mpcSigner(), verify);
  spend.psbt.finalizeAllInputs();
  const tx = spend.psbt.extractTransaction();
  assert.equal(tx.outs[0].value, 100_000n);
  assert.equal(tx.ins[0].witness.length, 2, "P2WPKH witness: signature and public key");
});

test("Swissquote's own digest equals the hash the phone signs, for savings and pocket inputs", async () => {
  const savingsSpend = buildSavingsPayment({ safe, utxos: [utxo(80_000, 3)], to: pocket.address, amount: 50_000n, feeRate: 1 });
  const seen: Uint8Array[] = [];
  await signAllInputs(savingsSpend.psbt, () => mpcSigner(seen), verify);
  const tx = Transaction.fromBuffer(savingsSpend.psbt.data.getTransaction());
  assert.deepEqual(inputSighash(tx, 0, mpcKey, 80_000n), seen[0]);

  // Pocket input spent through the MPC branch (the recovery sweep).
  const sweep = buildPocketPayment({ pocket, utxos: [utxo(40_000, 4)], to: safe.address, amount: 30_000n, feeRate: 1 });
  const seenPocket: Uint8Array[] = [];
  await signAllInputs(sweep.psbt, () => mpcSigner(seenPocket), verify);
  const sweepTx = Transaction.fromBuffer(sweep.psbt.data.getTransaction());
  assert.deepEqual(inputSighash(sweepTx, 0, mpcKey, 40_000n, pocket.witnessScript), seenPocket[0]);
});

test("the pocket is refilled to its target only once it is below half", () => {
  assert.equal(refillAmount(80_000n, 145_000n), 0n);
  assert.equal(refillAmount(72_500n, 145_000n), 0n);
  assert.equal(refillAmount(40_000n, 145_000n), 105_000n);
  assert.equal(refillAmount(0n, 145_000n), 145_000n);
});

test("the ownership proof is a valid BIP-322 signature by the Savings safe", async () => {
  const message = ownershipMessage("CH-4417-2093", safe.address, "2026-10-10T18:00:00Z");
  const toSign = ownershipToSign(message, safe.output);
  const seen: Uint8Array[] = [];
  await signAllInputs(toSign, () => mpcSigner(seen), verify);
  assert.deepEqual(ownershipDigest(message, safe.output, mpcKey), seen[0], "Swissquote computes the same digest");

  const proof = encodeOwnershipProof(toSign);
  assert.ok(verifyOwnershipProof(safe.address, message, proof));
  assert.equal(verifyOwnershipProof(safe.address, message.replace("CH-4417-2093", "CH-0000-0000"), proof), false);
  assert.equal(verifyOwnershipProof(leo, message, proof), false);
});

test("after a payment, the coins left are the unspent ones plus the change", () => {
  const coins = [utxo(60_000, 5), utxo(50_000, 6)];
  const spend = buildSavingsPayment({ safe, utxos: coins, to: leo, amount: 30_000n, feeRate: 1 });
  const left = coinsAfter(coins, spend, "f".repeat(64));
  assert.equal(left.length, 2);
  assert.deepEqual(left[0], coins[1], "the coin not used by the payment is still there");
  assert.deepEqual(left[1], { txid: "f".repeat(64), vout: 1, value: Number(spend.change), status: { confirmed: false } });
});
