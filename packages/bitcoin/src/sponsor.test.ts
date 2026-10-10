import { test } from "node:test";
import assert from "node:assert/strict";
import { Transaction } from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { savingsSafe, spendingPocket } from "./addresses";
import type { Utxo } from "./esplora";
import { newPocketKey, signPocketInputs } from "./pocket";
import { pocketSource, savingsSource, DUST_SATS } from "./spend";
import { buildSponsoredSpend, inputIndexOf, inputVsizes, sponsoredVsize, SponsorCoinTooSmallError, type FeeSponsor } from "./sponsor";

const mpcKey = secp256k1.getPublicKey(newPocketKey(), true);
const pocketKey = newPocketKey();
const pocket = spendingPocket(secp256k1.getPublicKey(pocketKey, true), mpcKey);
const safe = savingsSafe(mpcKey);
const feeKey = newPocketKey();
const feeWallet = savingsSafe(secp256k1.getPublicKey(feeKey, true)); // any P2WPKH
const leo = "tb1qlq2jjz3690pnygrytqptyy4rhterj4rswsw8pd";

const coin = (value: number, n: number): Utxo => ({ txid: n.toString(16).padStart(64, "d"), vout: 0, value, status: { confirmed: true } });
const sponsor = (value = 20_000): FeeSponsor => ({
  coin: coin(value, 99),
  output: feeWallet.output,
  changeAddress: feeWallet.address,
  feeRate: 2,
});

test("on Premium the client pays exactly the amount and Swissquote's coin pays the fee", () => {
  const spend = buildSponsoredSpend({ source: pocketSource(pocket), utxos: [coin(80_000, 1)], to: leo, amount: 50_000n, sponsor: sponsor() });
  const outs = spend.psbt.txOutputs;
  assert.equal(spend.paidBy, "swissquote");
  assert.equal(outs[0].value, 50_000n, "recipient");
  assert.equal(outs[1].value, 30_000n, "client change: nothing taken for the fee");
  assert.equal(outs[2].address, feeWallet.address);
  assert.equal(20_000n - outs[2].value, spend.fee, "Swissquote's coin minus its change is the whole fee");
  assert.equal(spend.fee, BigInt(sponsoredVsize(inputVsizes(spend.psbt).slice(0, 1), 3) * 2));
  assert.equal(spend.sponsorInputIndex, 1);
});

test("the pocket key signs only the client's inputs; Swissquote's coin is left for Swissquote", () => {
  const spend = buildSponsoredSpend({ source: pocketSource(pocket), utxos: [coin(80_000, 2)], to: leo, amount: 50_000n, sponsor: sponsor() });
  signPocketInputs(spend.psbt, pocketKey);
  assert.ok(spend.psbt.data.inputs[0].finalScriptWitness, "pocket input finalized");
  assert.equal(spend.psbt.data.inputs[1].finalScriptWitness, undefined, "fee coin untouched");
  const tx = Transaction.fromBuffer(spend.psbt.data.getTransaction());
  assert.equal(inputIndexOf(tx, { txid: sponsor().coin.txid, vout: 0 }), 1);
});

test("client change below dust joins the fee instead of creating an unspendable output", () => {
  const amount = 50_000n;
  const spend = buildSponsoredSpend({ source: savingsSource(safe), utxos: [coin(50_300, 3)], to: leo, amount, sponsor: sponsor() });
  assert.equal(spend.change, 0n);
  assert.equal(spend.psbt.txOutputs.length, 2, "recipient and Swissquote's change only");
  assert.ok(spend.fee >= 300n);
  assert.ok(300n < DUST_SATS);
});

test("a fee coin too small to leave Swissquote any change is refused", () => {
  assert.throws(
    () => buildSponsoredSpend({ source: savingsSource(safe), utxos: [coin(80_000, 4)], to: leo, amount: 50_000n, sponsor: sponsor(700) }),
    SponsorCoinTooSmallError,
  );
});
