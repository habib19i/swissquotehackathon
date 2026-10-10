/**
 * M1 check on real signet: the Spending pocket script works with both branches.
 *   pnpm pocket-check address   prints the pocket address (fund it with `pnpm send-btc <address>`)
 *   pnpm pocket-check spend     pays from the pocket with the pocket key alone, then sweeps
 *                               the rest with the 2-of-3 MPC key (the recovery path)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  buildPocketPayment,
  esplora,
  finalizePocketInputs,
  maxPocketAmount,
  newPocketKey,
  signWithPocketKey,
  spendingPocket,
  type Utxo,
} from "@sqw/bitcoin";
import { bitcoinCompact } from "@sqw/mpc";
import { sign } from "@sqw/mpc/node";
import { explorer } from "@sqw/shared";
import { loadShare, mpcAddresses, run } from "./wallet";

const POCKET_KEY_FILE = fileURLToPath(new URL("../.shares/pocket.key", import.meta.url));

function pocketKey(): Uint8Array {
  if (!existsSync(POCKET_KEY_FILE)) writeFileSync(POCKET_KEY_FILE, newPocketKey());
  return new Uint8Array(readFileSync(POCKET_KEY_FILE));
}

run(async () => {
  const net = esplora(process.env.BITCOIN_ESPLORA_URL);
  const phone = loadShare("phone");
  const cosigner = loadShare("cosigner");
  const key = pocketKey();
  const pocket = spendingPocket(secp256k1.getPublicKey(key, true), phone.publicKey);
  const { savingsSafe } = mpcAddresses(phone.publicKey);

  if (process.argv[2] !== "spend") {
    console.log(`Spending pocket: ${pocket.address}`);
    return;
  }

  const feeRate = await net.feeRate();
  const utxos = await net.utxos(pocket.address);
  if (utxos.length === 0) throw new Error(`The pocket is empty. Run \`pnpm send-btc ${pocket.address}\` first.`);

  // 1. Everyday payment: the phone alone, with the pocket key.
  const payment = buildPocketPayment({ pocket, utxos, to: savingsSafe, amount: 20_000n, feeRate });
  const paid = signWithPocketKey(payment.psbt, key);
  const txid1 = await net.broadcast(paid.hex);
  console.log(`Pocket key branch: paid 20000 sats, fee ${payment.fee}.\n  ${explorer.btcTx(txid1)}`);

  // 2. Recovery path: the MPC key (phone + Swissquote here) sweeps what is left in the pocket.
  const change: Utxo = { txid: txid1, vout: 1, value: Number(payment.change), status: { confirmed: false } };
  const sweep = buildPocketPayment({
    pocket,
    utxos: [change],
    to: savingsSafe,
    amount: maxPocketAmount([change], feeRate),
    feeRate,
  });
  sweep.psbt.signAllInputs({
    publicKey: phone.publicKey,
    sign: (hash: Uint8Array) => {
      const { r, s } = sign([phone, cosigner], hash);
      return bitcoinCompact(r, s);
    },
  });
  finalizePocketInputs(sweep.psbt, "mpc");
  const txid2 = await net.broadcast(sweep.psbt.extractTransaction().toHex());
  console.log(`MPC branch: swept ${sweep.amount} sats back to the Savings safe.\n  ${explorer.btcTx(txid2)}`);
});
