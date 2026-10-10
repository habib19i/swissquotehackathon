/**
 * M0 spike step 3: send a Base Sepolia transaction signed by 2 of 3 shares. Uses phone + recovery
 * provider, i.e. the "Swissquote offline" path.
 * Usage: pnpm send-eth [to] [eth]   (default: 0 ETH to itself)
 */
import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseEther,
  serializeTransaction,
  type TransactionSerializableEIP1559,
} from "viem";
import { baseSepolia } from "viem/chains";
import { hexToBytes } from "@noble/hashes/utils.js";
import { ethereumSignature } from "@sqw/mpc";
import { sign } from "@sqw/mpc/node";
import { explorer } from "@sqw/shared";
import { loadShare, mpcAddresses, run } from "./wallet";

run(async () => {
  const client = createPublicClient({ chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

  const phone = loadShare("phone");
  const provider = loadShare("recovery-provider");
  const { ethereum: address } = mpcAddresses(phone.publicKey);
  const to = process.argv[2] ? getAddress(process.argv[2]) : address;
  const value = parseEther(process.argv[3] ?? "0");

  if ((await client.getBalance({ address })) === 0n) {
    throw new Error(`No Base Sepolia ETH at ${address} yet. Fund it from a faucet and retry.`);
  }

  const fees = await client.estimateFeesPerGas();
  const tx: TransactionSerializableEIP1559 = {
    type: "eip1559",
    chainId: baseSepolia.id,
    nonce: await client.getTransactionCount({ address }),
    to,
    value,
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
