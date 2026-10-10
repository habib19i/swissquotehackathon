/**
 * Deploys the Base Sepolia contracts from Swissquote's operational wallet (its key never leaves this
 * process) and writes their addresses to @sqw/ethereum. Then fund the paymaster's gas deposit.
 *
 * Usage: pnpm --filter @sqw/contracts build && pnpm --filter @sqw/cosigner deploy:base
 *        pnpm --filter @sqw/cosigner fund:paymaster
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWalletClient, formatEther, getAddress, http, type Abi, type Address, type Hex } from "viem";
import { ENTRY_POINT, USDC, baseClient, chain } from "@sqw/ethereum";
import { explorer } from "@sqw/shared";
import { net } from "../src/cosign-policy";
import { db } from "../src/db";
import { hotWallet } from "../src/hot-wallet";

const root = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(root(`contracts/out/${name}.sol/${name}.json`), "utf8"));
  return { abi: json.abi, bytecode: json.bytecode.object };
}

const account = hotWallet(db, net).ethAccount;
const client = baseClient(process.env.BASE_SEPOLIA_RPC_URL);
const wallet = createWalletClient({ account, chain, transport: http(process.env.BASE_SEPOLIA_RPC_URL) });

async function deploy(name: string, args: unknown[]): Promise<Address> {
  const { abi, bytecode } = artifact(name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`${name} deployment failed: ${explorer.baseTx(hash)}`);
  const address = getAddress(receipt.contractAddress);
  // The public RPC is load-balanced: wait until its nodes see the code before the next step relies on it.
  while (!(await client.getCode({ address }))) await new Promise((resolve) => setTimeout(resolve, 1_000));
  console.log(`${name}: ${address}\n  ${explorer.baseTx(hash)}`);
  return address;
}

console.log(`Deploying from Swissquote's wallet ${account.address} (${formatEther(await client.getBalance(account))} ETH)`);

const implementation = await deploy("RulebookAccount", [USDC.address, account.address]);
const factory = await deploy("RulebookAccountFactory", [implementation]);
const paymaster = await deploy("SwissquotePaymaster", [ENTRY_POINT, account.address]);

writeFileSync(
  root("packages/ethereum/src/deployments.ts"),
  `/**
 * Our contracts on Base Sepolia. Written by \`pnpm --filter @sqw/cosigner deploy:base\`.
 */
export const DEPLOYMENTS = {
  chainId: ${chain.id},
  accountImplementation: "${implementation}",
  factory: "${factory}",
  paymaster: "${paymaster}",
  /** Swissquote: paymaster signer and recipient of Standard-plan USDC fees. */
  swissquote: "${account.address}",
} as const;
`,
);
console.log("Addresses written to packages/ethereum/src/deployments.ts. Next: pnpm --filter @sqw/cosigner fund:paymaster");
