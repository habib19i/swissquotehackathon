/**
 * USDC amounts (6 decimals).
 */
import { erc20Abi, type Address } from "viem";
import type { BaseClient } from "./client";
import { USDC } from "./config";

const UNIT = 10n ** BigInt(USDC.decimals);
const CENT = UNIT / 100n;

/** USDC units for a CHF amount, rounded down to the cent. */
export function usdcForChf(chf: number, usdcChf: number): bigint {
  return BigInt(Math.floor((chf / usdcChf) * 100)) * CENT;
}

export const chfForUsdc = (units: bigint, usdcChf: number) => (Number(units) / Number(UNIT)) * usdcChf;

/** USDC units from a decimal amount typed by the client, e.g. 12.5. */
export const usdcUnits = (amount: number) => BigInt(Math.round(amount * 100)) * CENT;

export function formatUsdc(units: bigint): string {
  return `USDC ${(Number(units) / Number(UNIT)).toLocaleString("en-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function usdcBalance(client: BaseClient, address: Address): Promise<bigint> {
  return client.readContract({ address: USDC.address, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}
