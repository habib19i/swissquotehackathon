/**
 * Base Sepolia settings (CLAUDE.md section 7). EntryPoint v0.9 is OpenZeppelin Account's default.
 */
import { entryPoint09Address } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";

export const chain = baseSepolia;

export const ENTRY_POINT = entryPoint09Address;
export const ENTRY_POINT_VERSION = "0.9" as const;

/** Circle's test USDC on Base Sepolia (faucet.circle.com). */
export const USDC = {
  address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  decimals: 6,
} as const;

/**
 * The live DeFi protocols on Base Sepolia (checked on-chain): Uniswap v3 (SwapRouter02, QuoterV2, the
 * USDC/WETH 0.3% pool) and Aave v3 (its Pool and the aWETH it issues; from aave-address-book).
 */
export const PROTOCOLS = {
  weth: "0x4200000000000000000000000000000000000006",
  uniswap: {
    router: "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4",
    quoter: "0xC5290058841028F1614F3A6F0F5816cAd0df5E27",
    fee: 3000,
  },
  aave: {
    pool: "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
    aWeth: "0x73a5bB60b0B0fc35710DDc0ea9c407031E31Bdbb",
  },
} as const;
