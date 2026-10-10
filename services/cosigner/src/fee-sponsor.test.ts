import { test } from "node:test";
import assert from "node:assert/strict";
import { Psbt } from "bitcoinjs-lib";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  buildSponsoredSpend,
  pocketSource,
  savingsSafe,
  savingsSource,
  signet,
  spendingPocket,
  type FeeSponsor,
  type Utxo,
} from "@sqw/bitcoin";
import { DEMO_CONTACTS, defaultRulebook, type WalletRecord } from "@sqw/shared";
import { PolicyError, reviewBtcSpend, mpcInputDigest, type Prevout } from "./bitcoin-policy";
import { checkSponsoredTx, type SponsorContext } from "./fee-sponsor";

const key = () => secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true);
const mpcKey = key();
const safe = savingsSafe(mpcKey);
const pocket = spendingPocket(key(), mpcKey);
const feeWallet = savingsSafe(key());
const leo = DEMO_CONTACTS[0].btcAddress!;

const clientCoin: Utxo = { txid: "a".repeat(64), vout: 0, value: 80_000, status: { confirmed: true } };
const feeCoin: Utxo = { txid: "f".repeat(64), vout: 1, value: 20_000, status: { confirmed: true } };
const sponsor: FeeSponsor = { coin: feeCoin, output: feeWallet.output, changeAddress: feeWallet.address, feeRate: 2 };
const offer = { coin: feeCoin, output: feeWallet.output, feeRate: 2 };

/** The network: the client's coin (in the pocket or the safe) and Swissquote's fee coin. */
function network(clientScript: Uint8Array) {
  return async (txid: string): Promise<Prevout> =>
    txid === clientCoin.txid
      ? { value: BigInt(clientCoin.value), script: clientScript }
      : { value: BigInt(feeCoin.value), script: feeWallet.output };
}
const ctx = (over: Partial<SponsorContext> = {}): SponsorContext => ({
  prevout: network(pocket.output),
  paidToday: 0n,
  dailyCap: 5_000n,
  ...over,
});
const sponsoredPocketPayment = () =>
  buildSponsoredSpend({ source: pocketSource(pocket), utxos: [clientCoin], to: leo, amount: 50_000n, sponsor });

test("Swissquote signs its fee coin when it pays only the network fee", async () => {
  const spend = sponsoredPocketPayment();
  const { inputIndex, sponsorPays } = await checkSponsoredTx(spend.psbt, offer, ctx());
  assert.equal(inputIndex, 1);
  assert.equal(sponsorPays, spend.fee);
});

test("a payment that drops Swissquote's change is refused", async () => {
  const spend = sponsoredPocketPayment();
  const psbt = new Psbt({ network: signet });
  spend.psbt.txInputs.forEach((input, i) => psbt.addInput({ ...input, witnessUtxo: spend.psbt.data.inputs[i].witnessUtxo }));
  spend.psbt.txOutputs.slice(0, -1).forEach((o) => psbt.addOutput({ script: o.script, value: o.value }));
  await assert.rejects(checkSponsoredTx(psbt, offer, ctx()), /does not return Swissquote's change/);
});

test("an app trying to pay its recipient with Swissquote's coin is refused", async () => {
  const psbt = new Psbt({ network: signet });
  psbt.addInput({ hash: clientCoin.txid, index: 0, witnessUtxo: { script: pocket.output, value: 80_000n }, witnessScript: pocket.witnessScript });
  psbt.addInput({ hash: feeCoin.txid, index: 1, witnessUtxo: { script: feeWallet.output, value: 20_000n } });
  psbt.addOutput({ address: leo, value: 95_000n }); // more than the client's 80,000
  psbt.addOutput({ address: feeWallet.address, value: 4_000n });
  await assert.rejects(checkSponsoredTx(psbt, offer, ctx()), /more than the network fee/);
});

test("a fee far above what Swissquote offered is refused", async () => {
  const greedy = buildSponsoredSpend({ source: pocketSource(pocket), utxos: [clientCoin], to: leo, amount: 50_000n, sponsor: { ...sponsor, feeRate: 50 } });
  await assert.rejects(checkSponsoredTx(greedy.psbt, offer, ctx()), /higher than Swissquote offered/);
});

test("Swissquote stops paying once the client's daily cap is reached", async () => {
  await assert.rejects(checkSponsoredTx(sponsoredPocketPayment().psbt, offer, ctx({ paidToday: 4_900n })), /today's limit/);
});

test("a sponsored Savings payment passes Swissquote's review, and the MPC key never signs the fee coin", async () => {
  const spend = buildSponsoredSpend({ source: savingsSource(safe), utxos: [clientCoin], to: leo, amount: 50_000n, sponsor });
  const wallet: WalletRecord = {
    walletId: "w",
    clientNumber: "CH-4417-2093",
    mpcPublicKey: bytesToHex(mpcKey),
    pocketPublicKey: "",
    savingsAddress: safe.address,
    pocketAddress: pocket.address,
    plan: "premium",
  };
  const reviewed = await reviewBtcSpend(spend.psbt.toBase64(), "savings-payment", {
    wallet,
    rulebook: { ...defaultRulebook(), contacts: DEMO_CONTACTS },
    btcChf: 70_000,
    prevout: network(safe.output),
    pocketBalance: async () => 0n,
    feeWalletAddress: feeWallet.address,
  });
  assert.equal(reviewed.review.verdict, "APPROVE");
  assert.deepEqual([...reviewed.mpcInputs.keys()], [0]);
  assert.throws(() => mpcInputDigest(reviewed, 1, mpcKey), PolicyError);
});
