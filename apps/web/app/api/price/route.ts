/**
 * Indicative BTC, ETH and USDC prices in CHF (CoinGecko), cached for a minute.
 * Test coins have no value: the app shows them at real prices to make the demo meaningful.
 */
export interface PriceQuote {
  btcChf: number;
  ethChf: number;
  usdcChf: number;
  source: string;
  /** True when the live price is unavailable and fixed demo values are used. */
  mock: boolean;
  at: string;
}

const FALLBACK = { btcChf: 70_000, ethChf: 2_500, usdcChf: 0.8 };
const TTL_MS = 60_000;
let cached: PriceQuote | undefined;

export async function GET() {
  if (cached && Date.now() - Date.parse(cached.at) < TTL_MS) return Response.json(cached);
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,usd-coin&vs_currencies=chf", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`CoinGecko answered ${res.status}`);
    const body = await res.json();
    cached = {
      btcChf: body.bitcoin.chf,
      ethChf: body.ethereum.chf,
      usdcChf: body["usd-coin"].chf,
      source: "CoinGecko",
      mock: false,
      at: new Date().toISOString(),
    };
    return Response.json(cached);
  } catch {
    return Response.json({ ...FALLBACK, source: "Fixed demo price", mock: true, at: new Date().toISOString() });
  }
}
