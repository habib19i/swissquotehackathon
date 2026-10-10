/**
 * Demo-mode timers. Production values are in comments; the UI must label shortened timers "Demo mode".
 */
const num = (v: string | undefined, fallback: number) => (v ? Number(v) : fallback);

export const LOOSENING_DELAY_SECONDS = num(process.env.LOOSENING_DELAY_SECONDS, 30); // production: 86_400 (24h)
export const RECOVERY_WAIT_SECONDS = num(process.env.RECOVERY_WAIT_SECONDS, 60); // production: 172_800 (48h)

export const BITCOIN_NETWORK = "signet" as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532;

export const explorer = {
  btcTx: (txid: string) => `https://mempool.space/signet/tx/${txid}`,
  baseTx: (hash: string) => `https://sepolia.basescan.org/tx/${hash}`,
};
