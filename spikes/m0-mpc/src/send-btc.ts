/**
 * M0 spike step 2: spend the MPC address on Bitcoin signet with 2 of 3 shares (phone + Swissquote)
 * and broadcast it. Usage: pnpm send-btc [destination-address]   (default: back to itself)
 */
import { Psbt } from "bitcoinjs-lib";
import { bitcoinCompact, verifyDigest } from "@sqw/mpc";
import { sign } from "@sqw/mpc/node";
import { explorer } from "@sqw/shared";
import { loadShare, mpcAddresses, run, signet } from "./wallet";

const ESPLORA = process.env.BITCOIN_ESPLORA_URL ?? "https://mempool.space/signet/api";

interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

run(async () => {
  const phone = loadShare("phone");
  const cosigner = loadShare("cosigner");
  const { savingsSafe, savingsSafeScript } = mpcAddresses(phone.publicKey);
  const destination = process.argv[2] ?? savingsSafe;

  // Only confirmed coins: faucet payouts often sit behind long unconfirmed chains the network won't extend.
  const allUtxos: Utxo[] = await (await fetch(`${ESPLORA}/address/${savingsSafe}/utxo`)).json();
  const utxos = allUtxos.filter((u) => u.status.confirmed);
  if (utxos.length === 0) {
    throw new Error(
      allUtxos.length > 0
        ? "Coins received but not confirmed yet. Signet makes a block about every 10 minutes; retry then."
        : `No coins at ${savingsSafe} yet. Fund it from a signet faucet and retry.`,
    );
  }

  const { halfHourFee } = await (await fetch(`${ESPLORA}/v1/fees/recommended`)).json();
  const feeRate = Math.max(Number(halfHourFee), 1) + 1; // sat/vB, small margin over the estimate
  const vbytes = Math.ceil(10.5 + 68 * utxos.length + 31); // P2WPKH inputs, one output
  const fee = BigInt(feeRate * vbytes);
  const total = utxos.reduce((sum, u) => sum + BigInt(u.value), 0n);

  const psbt = new Psbt({ network: signet });
  for (const u of utxos) {
    psbt.addInput({ hash: u.txid, index: u.vout, witnessUtxo: { script: savingsSafeScript, value: BigInt(u.value) } });
  }
  psbt.addOutput({ address: destination, value: total - fee });

  // The MPC key acts as a bitcoinjs signer: each sighash is signed jointly by the phone and Swissquote.
  const mpcSigner = {
    publicKey: phone.publicKey,
    sign(sighash: Uint8Array) {
      const { r, s } = sign([phone, cosigner], sighash);
      return bitcoinCompact(r, s);
    },
  };

  console.log(`Signing ${utxos.length} input(s) with phone + Swissquote shares (2 of 3)...`);
  psbt.signAllInputs(mpcSigner);
  utxos.forEach((_, i) => {
    if (!psbt.validateSignaturesOfInput(i, (pk, hash, sig) => verifyDigest(sig, hash, pk))) {
      throw new Error(`Invalid MPC signature on input ${i}`);
    }
  });
  psbt.finalizeAllInputs();
  const tx = psbt.extractTransaction();

  const res = await fetch(`${ESPLORA}/tx`, { method: "POST", body: tx.toHex() });
  const body = await res.text();
  if (!res.ok) throw new Error(`Broadcast refused by the network: ${body}`);

  console.log(`Sent ${total - fee} sats to ${destination} (fee ${fee} sats).`);
  console.log(`txid: ${body}`);
  console.log(explorer.btcTx(body));
});
