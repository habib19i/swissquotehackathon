/**
 * M0 spike step 3: send a Base Sepolia transaction signed by 2 of 3 shares. Uses phone + recovery
 * provider, i.e. the "Swissquote offline" path. Usage: pnpm send-eth   (0 ETH to itself)
 */
import { createPublicClient, http, keccak256, serializeTransaction, type TransactionSerializableEIP1559 } from "viem";
import { baseSepolia } from "viem/chains";
import { hexToBytes } from "@noble/hashes/utils.js";
import { ethereumSignature, sign } from "@sqw/mpc";
import { explorer } from "@sqw/shared";
import { loadShare, mpcAddresses, run } from "./wallet";

run(async () => {
  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

  const phone = loadShare("phone");
  const provider = loadShare("recovery-provider");
  const { ethereum: address } = mpcAddresses(phone.publicKey);

  if ((await client.getBalance({ address })) === 0n) {
    throw new Error(`No Base Sepolia ETH at ${address} yet. Fund it from a faucet and retry.`);
  }

  const fees = await client.estimateFeesPerGas();
  const tx: TransactionSerializableEIP1559 = {
    type: "eip1559",
    chainId: baseSepolia.id,
    nonce: await client.getTransactionCount({ address }),
    to: address,
    value: 0n,
    gas: 21_000n,
    maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
  };

  console.log("Signing with phone + recovery provider shares (2 of 3, Swissquote not involved)...");
  const digest = hexToBytes(keccak256(serializeTransaction(tx)).slice(2));
  const { r, s } = sign([phone, provider], digest);
  const signed = serializeTransaction(tx, ethereumSignature(r, s, digest, phone.publicKey));

  const hash = await client.sendRawTransaction({ serializedTransaction: signed });
  console.log(`tx hash: ${hash}`);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`Status: ${receipt.status} in block ${receipt.blockNumber}`);
  console.log(explorer.baseTx(hash));
});
