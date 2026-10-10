/**
 * Swissquote's own CHF prices (CLAUDE.md section 9: the service recomputes CHF values itself and
 * never trusts the app's numbers). CoinGecko, cached for a minute; fixed demo prices if unreachable.
 */
const FALLBACK = { btcChf: 70_000, ethChf: 2_500, usdcChf: 0.8 };
const TTL_MS = 60_000;

export type Prices = typeof FALLBACK;
let cached: { prices: Prices; at: number } | undefined;

export async function prices(): Promise<Prices> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.prices;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,usd-coin&vs_currencies=chf", {
      signal: AbortSignal.timeout(5_000),
    });
    const body = await res.json();
    const fresh = { btcChf: Number(body.bitcoin.chf), ethChf: Number(body.ethereum.chf), usdcChf: Number(body["usd-coin"].chf) };
    if (!Object.values(fresh).every((p) => p > 0)) throw new Error("Incomplete prices");
    cached = { prices: fresh, at: Date.now() };
    return fresh;
  } catch {
    return cached?.prices ?? FALLBACK;
  }
}

export const btcChf = async () => (await prices()).btcChf;
export const usdcChf = async () => (await prices()).usdcChf;
