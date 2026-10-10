import { test } from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bitcoinCompact, verifyDigest } from "@sqw/mpc";
import { keygen, sign } from "@sqw/mpc/node";
import { savingsSafe, spendingPocket } from "./addresses";
import type { Utxo } from "./esplora";
import {
  DUST_SATS,
  InsufficientFundsError,
  buildPocketPayment,
  finalizePocketInputs,
  maxPocketAmount,
  newPocketKey,
  pocketSpendVsize,
  signWithPocketKey,
} from "./pocket";
import { chfToSats, satsToBtc } from "./units";

const [phoneShare, cosignerShare] = keygen();
const mpcKey = phoneShare.publicKey;
const pocketKey = newPocketKey();
const pocket = spendingPocket(secp256k1.getPublicKey(pocketKey, true), mpcKey);
const leo = savingsSafe(secp256k1.getPublicKey(newPocketKey(), true)).address; // any signet address

const utxo = (value: number, confirmed = true, n = 0): Utxo => ({
  txid: n.toString(16).padStart(64, "a"),
  vout: 0,
  value,
  status: { confirmed },
});

test("pocket and savings safe are distinct signet segwit addresses", () => {
  assert.match(pocket.address, /^tb1q[0-9a-z]{58}$/, "P2WSH");
  assert.match(savingsSafe(mpcKey).address, /^tb1q[0-9a-z]{38}$/, "P2WPKH");
  const otherPocket = spendingPocket(secp256k1.getPublicKey(newPocketKey(), true), mpcKey);
  assert.notEqual(pocket.address, otherPocket.address);
});

test("the phone pays from the pocket alone with its pocket key", () => {
  const { psbt, fee, change } = buildPocketPayment({ pocket, utxos: [utxo(150_000)], to: leo, amount: 50_000n, feeRate: 2 });
  const { hex, txid } = signWithPocketKey(psbt, pocketKey);
  const tx = psbt.extractTransaction();

  assert.match(txid, /^[0-9a-f]{64}$/);
  assert.equal(tx.toHex(), hex);
  assert.equal(tx.outs[0].value, 50_000n);
  assert.equal(tx.outs[1].value, change);
  assert.equal(150_000n - 50_000n - change, fee);
  const [, selector, witnessScript] = tx.ins[0].witness;
  assert.deepEqual(selector, Uint8Array.of(1), "pocket-key branch");
  assert.deepEqual(witnessScript, pocket.witnessScript);
  assert.ok(tx.virtualSize() <= pocketSpendVsize(1, 2), "fee estimate covers the real size");
});

test("the MPC key can sweep the pocket (recovery path)", () => {
  const { psbt } = buildPocketPayment({ pocket, utxos: [utxo(150_000)], to: leo, amount: 100_000n, feeRate: 2 });
  psbt.signAllInputs({
    publicKey: mpcKey,
    sign: (hash: Uint8Array) => {
      const { r, s } = sign([phoneShare, cosignerShare], hash);
      return bitcoinCompact(r, s);
    },
  });
  assert.ok(psbt.validateSignaturesOfInput(0, (pk, hash, sig) => verifyDigest(sig, hash, pk)));
  finalizePocketInputs(psbt, "mpc");
  const [, selector] = psbt.extractTransaction().ins[0].witness;
  assert.equal(selector.length, 0, "MPC branch");
});

test("a key that is not in the pocket script cannot sign it", () => {
  const { psbt } = buildPocketPayment({ pocket, utxos: [utxo(150_000)], to: leo, amount: 50_000n, feeRate: 2 });
  assert.throws(() => signWithPocketKey(psbt, newPocketKey()));
});

test("dust change is left to the fee instead of creating an unspendable output", () => {
  const feeRate = 2;
  const amount = 100_000n;
  const exact = amount + BigInt(pocketSpendVsize(1, 2) * feeRate) + DUST_SATS - 1n;
  const { psbt, change, fee } = buildPocketPayment({ pocket, utxos: [utxo(Number(exact))], to: leo, amount, feeRate });
  assert.equal(change, 0n);
  assert.equal(psbt.txOutputs.length, 1);
  assert.equal(fee, exact - amount);
});

test("paying more than the pocket holds is refused with the maximum available", () => {
  const utxos = [utxo(60_000, true, 1), utxo(40_000, false, 2)];
  const max = maxPocketAmount(utxos, 2);
  assert.equal(max, 100_000n - BigInt(pocketSpendVsize(2, 1) * 2));
  assert.throws(
    () => buildPocketPayment({ pocket, utxos, to: leo, amount: 100_000n, feeRate: 2 }),
    (err: unknown) => err instanceof InsufficientFundsError && err.available === max,
  );
  // The maximum itself goes through, as one output with no change.
  const { psbt } = buildPocketPayment({ pocket, utxos, to: leo, amount: max, feeRate: 2 });
  assert.equal(psbt.txOutputs.length, 1);
});

test("confirmed coins are spent before unconfirmed ones", () => {
  const utxos = [utxo(90_000, false, 1), utxo(80_000, true, 2)];
  const { psbt } = buildPocketPayment({ pocket, utxos, to: leo, amount: 10_000n, feeRate: 1 });
  assert.equal(psbt.txInputs.length, 1);
  assert.equal(Buffer.from(psbt.txInputs[0].hash).reverse().toString("hex"), utxos[1].txid);
});

test("CHF and BTC conversions", () => {
  assert.equal(chfToSats(100, 50_000), 200_000n);
  assert.equal(satsToBtc(200_000n), "0.002");
  assert.equal(satsToBtc(100_000_000n), "1");
});

test("signatures from the pocket key verify against the pocket key only", () => {
  const digest = crypto.getRandomValues(new Uint8Array(32));
  const sig = secp256k1.sign(digest, pocketKey, { prehash: false });
  assert.ok(verifyDigest(sig, digest, secp256k1.getPublicKey(pocketKey, true)));
  assert.equal(verifyDigest(sig, digest, mpcKey), false);
});
