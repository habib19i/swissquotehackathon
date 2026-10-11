/**
 * The live DeFi apps on Base Sepolia, through Swissquote's adapters (contracts/src/apps): parameters,
 * quotes and positions. Whatever an app gives back always lands in the client's own account.
 */
import { decodeAbiParameters, encodeAbiParameters, erc20Abi, isAddressEqual, parseAbi, type Address, type Hex } from "viem";
import type { BaseClient } from "./client";
import { PROTOCOLS, USDC } from "./config";
import { DEPLOYMENTS } from "./deployments";

export type LiveAppId = keyof typeof DEPLOYMENTS.adapters;

export const adapterOf = (appId: string): Address | undefined => DEPLOYMENTS.adapters[appId as LiveAppId];
export const appOfAdapter = (adapter: Address): LiveAppId | undefined =>
  (Object.keys(DEPLOYMENTS.adapters) as LiveAppId[]).find((id) => isAddressEqual(DEPLOYMENTS.adapters[id], adapter));

/** A swap may give at most 1% less than the quote shown on the card. */
export const SLIPPAGE_BPS = 100n;

// ---------------------------------------------------------------- parameters

export type AppRequest =
  | { app: "uniswap"; tokenIn: Address; amountIn: bigint; minOut: bigint }
  | { app: "aave"; action: "supply" | "withdraw"; amount: bigint };

const SWAP = [{ type: "address" }, { type: "uint256" }, { type: "uint256" }] as const;
const AAVE = [{ type: "uint8" }, { type: "uint256" }] as const;

export function appParams(request: AppRequest): Hex {
  return request.app === "uniswap"
    ? encodeAbiParameters(SWAP, [request.tokenIn, request.amountIn, request.minOut])
    : encodeAbiParameters(AAVE, [request.action === "supply" ? 0 : 1, request.amount]);
}

export function decodeAppParams(app: LiveAppId, params: Hex): AppRequest {
  if (app === "uniswap") {
    const [tokenIn, amountIn, minOut] = decodeAbiParameters(SWAP, params);
    return { app, tokenIn, amountIn, minOut };
  }
  const [action, amount] = decodeAbiParameters(AAVE, params);
  return { app, action: action === 0 ? "supply" : "withdraw", amount };
}

/** The other token of the Uniswap pair. */
export const otherToken = (token: Address): Address => (isAddressEqual(token, USDC.address) ? PROTOCOLS.weth : USDC.address);

// ---------------------------------------------------------------- market data

const quoterAbi = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) returns (uint256 amountOut, uint160, uint32, uint256)",
]);

/** What Uniswap would give for `amountIn` right now (QuoterV2, simulated). */
export async function quoteSwap(client: BaseClient, tokenIn: Address, amountIn: bigint): Promise<bigint> {
  const { result } = await client.simulateContract({
    address: PROTOCOLS.uniswap.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [{ tokenIn, tokenOut: otherToken(tokenIn), amountIn, fee: PROTOCOLS.uniswap.fee, sqrtPriceLimitX96: 0n }],
  });
  return result[0];
}

export const minimumOut = (quoted: bigint) => (quoted * (10_000n - SLIPPAGE_BPS)) / 10_000n;

const reserveAbi = parseAbi([
  "function getReserveData(address) view returns ((uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt))",
]);

/** Aave's current yearly rate on ETH deposits, e.g. 0.022 for 2.2%. */
export async function aaveEthRate(client: BaseClient): Promise<number> {
  const reserve = await client.readContract({ address: PROTOCOLS.aave.pool, abi: reserveAbi, functionName: "getReserveData", args: [PROTOCOLS.weth] });
  return Number(reserve.currentLiquidityRate) / 1e27;
}

/** ETH held directly (WETH) and ETH deposited in Aave (aWETH, which grows with the interest). */
export async function defiPositions(client: BaseClient, account: Address): Promise<{ eth: bigint; ethInAave: bigint }> {
  const [eth, ethInAave] = await client.multicall({
    contracts: [
      { address: PROTOCOLS.weth, abi: erc20Abi, functionName: "balanceOf", args: [account] },
      { address: PROTOCOLS.aave.aWeth, abi: erc20Abi, functionName: "balanceOf", args: [account] },
    ],
    allowFailure: false,
  });
  return { eth, ethInAave };
}

export function formatEth(wei: bigint): string {
  return `ETH ${(Number(wei) / 1e18).toLocaleString("en-CH", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
}
