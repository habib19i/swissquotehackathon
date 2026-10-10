/** Conversions between satoshis, BTC and CHF. Amounts are bigint satoshis everywhere in code. */
export const SATS_PER_BTC = 100_000_000n;

export function satsToBtc(sats: bigint): string {
  const negative = sats < 0n;
  const abs = negative ? -sats : sats;
  const whole = abs / SATS_PER_BTC;
  const frac = (abs % SATS_PER_BTC).toString().padStart(8, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

export function satsToChf(sats: bigint, btcChf: number): number {
  return (Number(sats) / Number(SATS_PER_BTC)) * btcChf;
}

/** Rounded down so a CHF amount never turns into more bitcoin than intended. */
export function chfToSats(chf: number, btcChf: number): bigint {
  if (!(btcChf > 0)) throw new Error("No bitcoin price available");
  return BigInt(Math.floor((chf / btcChf) * Number(SATS_PER_BTC)));
}
