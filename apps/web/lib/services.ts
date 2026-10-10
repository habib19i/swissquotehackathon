/**
 * The two key-share holders, reached through this app's origin (see next.config.ts rewrites).
 * The proxy only forwards requests: shares stay in each service's own process and database.
 */
export const COSIGNER_URL = "/svc/cosigner";
export const RECOVERY_URL = "/svc/recovery";

export const ESPLORA_URL = process.env.NEXT_PUBLIC_ESPLORA_URL ?? "https://mempool.space/signet/api";
