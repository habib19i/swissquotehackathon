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
