/** Offline checks of the spike's chain integration, before spending real testnet coins. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Psbt } from "bitcoinjs-lib";
import { keccak256, recoverTransactionAddress, serializeTransaction } from "viem";
import { baseSepolia } from "viem/chains";
import { hexToBytes } from "@noble/hashes/utils.js";
import { bitcoinCompact, ethereumSignature, keygen, sign, verifyDigest } from "@sqw/mpc";
import { mpcAddresses, signet } from "./wallet";

const [phone, cosigner, provider] = keygen();
const addresses = mpcAddresses(phone.publicKey);

test("MPC-signed signet transaction is valid and finalizes", () => {
  const psbt = new Psbt({ network: signet });
  psbt.addInput({
    hash: "aa".repeat(32),
    index: 0,
    witnessUtxo: { script: addresses.savingsSafeScript, value: 100_000n },
  });
  psbt.addOutput({ address: addresses.savingsSafe, value: 99_800n });
  psbt.signAllInputs({
    publicKey: phone.publicKey,
    sign: (hash: Uint8Array) => {
      const { r, s } = sign([phone, cosigner], hash);
      return bitcoinCompact(r, s);
    },
  });
  assert.ok(psbt.validateSignaturesOfInput(0, (pk, hash, sig) => verifyDigest(sig, hash, pk)));
  psbt.finalizeAllInputs();
  assert.match(psbt.extractTransaction().getId(), /^[0-9a-f]{64}$/);
});

test("MPC-signed Base Sepolia transaction recovers to the MPC address", async () => {
  const tx = {
    type: "eip1559",
    chainId: baseSepolia.id,
    nonce: 0,
    to: addresses.ethereum,
    value: 0n,
    gas: 21_000n,
    maxFeePerGas: 1_000_000n,
    maxPriorityFeePerGas: 1_000n,
  } as const;
  const digest = hexToBytes(keccak256(serializeTransaction(tx)).slice(2));
  const { r, s } = sign([phone, provider], digest);
  const signed = serializeTransaction(tx, ethereumSignature(r, s, digest, phone.publicKey));
  assert.equal(await recoverTransactionAddress({ serializedTransaction: signed }), addresses.ethereum);
});
