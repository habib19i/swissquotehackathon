/**
 * Swissquote's own BTC/CHF price (CLAUDE.md section 9: the service recomputes CHF values itself and
 * never trusts the app's numbers). CoinGecko, cached for a minute; a fixed demo price if unreachable.
 */
const FALLBACK_BTC_CHF = 70_000;
const TTL_MS = 60_000;
let cached: { btcChf: number; at: number } | undefined;

export async function btcChf(): Promise<number> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.btcChf;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=chf", {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json();
    cached = { btcChf: Number(body.bitcoin.chf), at: Date.now() };
    return cached.btcChf;
  } catch {
    return FALLBACK_BTC_CHF;
  }
}
