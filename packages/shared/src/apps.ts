/**
 * DeFi apps in Explore: protocols Swissquote has looked at. Only `live` ones can be used from the wallet,
 * each through a Swissquote-vetted adapter (contracts/src/apps); the others are shown for
 * discovery, and their page says they cannot be used from the wallet yet.
 * Descriptions are plain language for clients who are new to DeFi.
 */
export interface DefiApp {
  id: string;
  name: string;
  category: "Exchange" | "Earn" | "Staking" | "Lending";
  /** One line, shown in lists. */
  tagline: string;
  /** What it does and what to know, shown on the app's page. */
  about: string;
  live: boolean;
}

export const APPS: DefiApp[] = [
  {
    id: "uniswap",
    name: "Uniswap",
    category: "Exchange",
    tagline: "Exchange USDC for ETH, and back",
    about:
      "The largest exchange that runs on its own, without a company in the middle. You swap directly with a pool of funds; the price moves with supply and demand, and a small fee goes to the pool.",
    live: true,
  },
  {
    id: "aave",
    name: "Aave",
    category: "Earn",
    tagline: "Earn interest on your ETH",
    about:
      "A lending market: you deposit ETH, borrowers pay interest on it, and you can take it back at any time. The rate changes with demand.",
    live: true,
  },
  {
    id: "compound",
    name: "Compound",
    category: "Lending",
    tagline: "Lend and earn a variable rate",
    about: "One of the first lending markets: deposit assets to earn interest from borrowers.",
    live: false,
  },
  {
    id: "morpho",
    name: "Morpho",
    category: "Earn",
    tagline: "Curated lending vaults",
    about: "Lending vaults run by risk curators, who choose which loans your deposit funds.",
    live: false,
  },
  {
    id: "lido",
    name: "Lido",
    category: "Staking",
    tagline: "Stake ETH and earn network rewards",
    about: "Earn the rewards for helping run the Ethereum network, while your ETH stays usable.",
    live: false,
  },
  {
    id: "aerodrome",
    name: "Aerodrome",
    category: "Exchange",
    tagline: "The main exchange on Base",
    about: "An exchange built for the Base network, with pools for most of its tokens.",
    live: false,
  },
  {
    id: "curve",
    name: "Curve",
    category: "Exchange",
    tagline: "Low-cost exchange between stable coins",
    about: "An exchange specialised in assets of similar value, such as different dollar coins.",
    live: false,
  },
  {
    id: "spark",
    name: "Spark",
    category: "Lending",
    tagline: "Savings rate on digital dollars",
    about: "A savings rate on dollar coins, backed by the Sky (formerly Maker) protocol.",
    live: false,
  },
];

export const appById = (id: string) => APPS.find((a) => a.id === id);

/** Search by name, category or what it does. */
export function searchApps(query: string): DefiApp[] {
  const q = query.trim().toLowerCase();
  if (!q) return APPS;
  return APPS.filter((a) => [a.name, a.category, a.tagline, a.about].some((text) => text.toLowerCase().includes(q)));
}
