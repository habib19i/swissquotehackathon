import { test } from "node:test";
import assert from "node:assert/strict";
import { Psbt, address as btcAddress } from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { buildSavingsPayment, chfToSats, inputSighash, savingsSafe, signet, spendingPocket, type Utxo } from "@sqw/bitcoin";
import { DEMO_ATTACKER_BTC_ADDRESS, DEMO_CONTACTS, defaultRulebook, type WalletRecord } from "@sqw/shared";
import { MAX_FEE_SATS, PolicyError, reviewBtcSpend, mpcInputDigest, type ReviewContext } from "./bitcoin-policy";

const BTC_CHF = 70_000;
const mpcKey = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
const safe = savingsSafe(mpcKey);
const pocket = spendingPocket(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true), mpcKey);
const leo = DEMO_CONTACTS[0].btcAddress!;

const wallet: WalletRecord = {
  walletId: "w1",
  clientNumber: "CH-4417-2093",
  mpcPublicKey: bytesToHex(mpcKey),
  pocketPublicKey: "",
  savingsAddress: safe.address,
  pocketAddress: pocket.address,
  plan: "standard",
};

const coin: Utxo = { txid: "c".repeat(64), vout: 0, value: 10_000_000, status: { confirmed: true } }; // CHF 7,000

/** The network as Swissquote sees it: one coin in the client's Savings safe. */
function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return {
    wallet,
    rulebook: { ...defaultRulebook(), contacts: DEMO_CONTACTS },
    btcChf: BTC_CHF,
    prevout: async (txid, vout) => {
      if (txid !== coin.txid || vout !== coin.vout) throw new PolicyError("unknown coin");
      return { value: BigInt(coin.value), script: safe.output };
    },
    pocketBalance: async () => 0n,
    ...overrides,
  };
}

const pay = (to: string, chf: number, feeRate = 2) =>
  buildSavingsPayment({ safe, utxos: [coin], to, amount: chfToSats(chf, BTC_CHF), feeRate }).psbt;

test("a payment to Léo from the Savings safe is approved, with Swissquote's own values", async () => {
  const { review } = await reviewBtcSpend(pay(leo, 50).toBase64(), "savings-payment", context());
  assert.equal(review.verdict, "APPROVE");
  assert.ok(Math.abs(review.valueChf - 50) < 0.01);
  assert.ok(review.feeChf > 0);
});

test("Swissquote signs the digest of the reviewed transaction, input by input", async () => {
  const psbt = pay(leo, 50);
  const spend = await reviewBtcSpend(psbt.toBase64(), "savings-payment", context());
  assert.deepEqual(mpcInputDigest(spend, 0, mpcKey), inputSighash(spend.tx, 0, mpcKey, BigInt(coin.value)));
  assert.throws(() => mpcInputDigest(spend, 1, mpcKey), /no input 1/);
});

test("attacker mode: CHF 5,000 from the Savings safe to the thief is blocked", async () => {
  const { review } = await reviewBtcSpend(pay(DEMO_ATTACKER_BTC_ADDRESS, 5_000).toBase64(), "savings-payment", context());
  assert.equal(review.verdict, "BLOCKED");
});

test("an app lying about a coin's value is refused (values come from the network)", async () => {
  const psbt = pay(leo, 50);
  psbt.data.inputs[0].witnessUtxo = { script: safe.output, value: 9_000_000n };
  await assert.rejects(reviewBtcSpend(psbt.toBase64(), "savings-payment", context()), /does not match the Bitcoin network/);
});

test("coins that are not in the client's Savings safe are refused", async () => {
  const elsewhere = context({ prevout: async () => ({ value: BigInt(coin.value), script: pocket.output }) });
  await assert.rejects(reviewBtcSpend(pay(leo, 50).toBase64(), "savings-payment", elsewhere), /Only coins in your Savings safe/);
});

test("an absurd network fee is blocked", async () => {
  const feeRate = Number(MAX_FEE_SATS) / 100; // far above any normal rate
  const { review } = await reviewBtcSpend(pay(leo, 50, feeRate).toBase64(), "savings-payment", context());
  assert.equal(review.verdict, "BLOCKED");
  assert.match(review.reasons[0], /network fee is unusually high/);
});

test("a refill tops up the client's own pocket up to its size, not beyond", async () => {
  const refill = (chf: number) => pay(pocket.address, chf).toBase64();
  assert.equal((await reviewBtcSpend(refill(80), "pocket-refill", context())).review.verdict, "APPROVE");

  const almostFull = context({ pocketBalance: async () => chfToSats(60, BTC_CHF) });
  const over = await reviewBtcSpend(refill(80), "pocket-refill", almostFull);
  assert.equal(over.review.verdict, "BLOCKED");
  assert.match(over.review.reasons[0], /more than CHF.100.00 in your Spending pocket/);
});

test("a 'refill' that pays anyone but the client's own pocket is refused", async () => {
  await assert.rejects(reviewBtcSpend(pay(leo, 20).toBase64(), "pocket-refill", context()), /only go to your own Spending pocket/);
});

test("a savings payment must have exactly one recipient", async () => {
  const psbt = new Psbt({ network: signet });
  psbt.addInput({ hash: coin.txid, index: coin.vout, witnessUtxo: { script: safe.output, value: BigInt(coin.value) } });
  psbt.addOutput({ address: leo, value: 10_000n });
  psbt.addOutput({ script: btcAddress.toOutputScript(DEMO_ATTACKER_BTC_ADDRESS, signet), value: 10_000n });
  await assert.rejects(reviewBtcSpend(psbt.toBase64(), "savings-payment", context()), /exactly one recipient/);
});
