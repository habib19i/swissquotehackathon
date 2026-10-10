/**
 * The two key-share holders, reached through this app's origin (see next.config.ts rewrites).
 * The proxy only forwards requests: shares stay in each service's own process and database.
 */
export const COSIGNER_URL = "/svc/cosigner";
export const RECOVERY_URL = "/svc/recovery";

export const ESPLORA_URL = process.env.NEXT_PUBLIC_ESPLORA_URL ?? "https://mempool.space/signet/api";

/** Base Sepolia: the public RPC for reads, and Blockscout's API for the USDC history. */
export const BASE_RPC_URL = process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";
export const BLOCKSCOUT_URL = "https://base-sepolia.blockscout.com";
