/**
 * A read client for Base Sepolia. Typed with Base's own transaction formats, so every helper here
 * takes this client rather than viem's generic PublicClient.
 */
import { createPublicClient, http } from "viem";
import { chain } from "./config";

export function baseClient(rpcUrl?: string) {
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

export type BaseClient = ReturnType<typeof baseClient>;
