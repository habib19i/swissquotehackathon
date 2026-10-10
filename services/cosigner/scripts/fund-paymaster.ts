/**
 * Tops up SwissquotePaymaster's gas deposit at the EntryPoint from Swissquote's operational wallet.
 *
 * Usage: pnpm --filter @sqw/cosigner fund:paymaster [eth]   (default 0.02)
 */
import { createWalletClient, formatEther, http, parseEther } from "viem";
import { entryPoint09Abi } from "viem/account-abstraction";
import { DEPLOYMENTS, ENTRY_POINT, baseClient, chain, paymasterAbi } from "@sqw/ethereum";
import { explorer } from "@sqw/shared";
import { net } from "../src/cosign-policy";
import { db } from "../src/db";
import { hotWallet } from "../src/hot-wallet";

const amount = parseEther(process.argv[2] ?? "0.02");
const account = hotWallet(db, net).ethAccount;
const client = baseClient(process.env.BASE_SEPOLIA_RPC_URL);
const wallet = createWalletClient({ account, chain, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

const deposit = () => client.readContract({ address: ENTRY_POINT, abi: entryPoint09Abi, functionName: "balanceOf", args: [DEPLOYMENTS.paymaster] });

console.log(`Paymaster deposit before: ${formatEther(await deposit())} ETH`);
// Explicit gas: a lagging RPC node could estimate this call before it sees the paymaster's code.
const hash = await wallet.writeContract({ address: DEPLOYMENTS.paymaster, abi: paymasterAbi, functionName: "deposit", value: amount, gas: 100_000n });
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`Deposit failed: ${explorer.baseTx(hash)}`);
console.log(`Deposited ${formatEther(amount)} ETH: ${explorer.baseTx(hash)}`);
console.log(`Paymaster deposit now: ${formatEther(await deposit())} ETH`);
