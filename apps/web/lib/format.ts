import { satsToBtc, satsToChf } from "@sqw/bitcoin";

const chf = new Intl.NumberFormat("de-CH", { style: "currency", currency: "CHF" });

/** Swiss formatting: CHF 1’234.50 */
export function formatChf(amount: number): string {
  return chf.format(amount);
}

export function formatSatsAsChf(sats: bigint, btcChf: number | undefined): string {
  return btcChf ? formatChf(satsToChf(sats, btcChf)) : "…";
}

export function formatBtc(sats: bigint): string {
  return `${satsToBtc(sats)} BTC`;
}

export function shortId(txid: string): string {
  return `${txid.slice(0, 8)}…${txid.slice(-6)}`;
}
