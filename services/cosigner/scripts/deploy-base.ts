/**
 * Deploys the Base Sepolia contracts from Swissquote's operational wallet (its key never leaves this
 * process) and writes their addresses to @sqw/ethereum: the account implementation and its factory, the
 * vetted DeFi app adapters, and the paymaster if none is live yet. The previous factory is kept as a
 * legacy one, so safes created before keep working. Then fund the paymaster's gas deposit if needed.
 *
 * Usage: pnpm --filter @sqw/contracts build && pnpm --filter @sqw/cosigner deploy:base
 *        pnpm --filter @sqw/cosigner fund:paymaster
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createWalletClient, formatEther, getAddress, http, type Abi, type Address, type Hex } from "viem";
import { DEPLOYMENTS, ENTRY_POINT, PROTOCOLS, USDC, baseClient, chain } from "@sqw/ethereum";
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

const isLive = async (address: Address) => /^0x0+$/.test(address) === false && Boolean(await client.getCode({ address }));

console.log(`Deploying from Swissquote's wallet ${account.address} (${formatEther(await client.getBalance(account))} ETH)`);

const implementation = await deploy("RulebookAccount", [USDC.address, account.address]);
const factory = await deploy("RulebookAccountFactory", [implementation]);
const uniswapAdapter = await deploy("UniswapAdapter", [PROTOCOLS.uniswap.router, USDC.address, PROTOCOLS.weth, PROTOCOLS.uniswap.fee]);
const aaveAdapter = await deploy("AaveAdapter", [PROTOCOLS.aave.pool, PROTOCOLS.weth]);
const paymaster = (await isLive(DEPLOYMENTS.paymaster)) ? DEPLOYMENTS.paymaster : await deploy("SwissquotePaymaster", [ENTRY_POINT, account.address]);
const legacyFactories = [...DEPLOYMENTS.legacyFactories, ...((await isLive(DEPLOYMENTS.factory)) ? [DEPLOYMENTS.factory] : [])];

const list = (addresses: readonly string[]) => `[${addresses.map((a) => `"${a}"`).join(", ")}]`;
writeFileSync(
  root("packages/ethereum/src/deployments.ts"),
  `/**
 * Our contracts on Base Sepolia. Written by \`pnpm --filter @sqw/cosigner deploy:base\`.
 */
export const DEPLOYMENTS = {
  chainId: ${chain.id},
  accountImplementation: "${implementation}",
  factory: "${factory}",
  /** Factories of earlier account versions: safes created with them keep working, without apps. */
  legacyFactories: ${list(legacyFactories)} as \`0x\${string}\`[],
  paymaster: "${paymaster}",
  /** Swissquote: paymaster signer and recipient of Standard-plan USDC fees. */
  swissquote: "${account.address}",
  /** Swissquote-vetted DeFi app adapters. */
  adapters: {
    uniswap: "${uniswapAdapter}",
    aave: "${aaveAdapter}",
  },
} as const;
`,
);
console.log("Addresses written to packages/ethereum/src/deployments.ts. If the paymaster is new: pnpm --filter @sqw/cosigner fund:paymaster");
