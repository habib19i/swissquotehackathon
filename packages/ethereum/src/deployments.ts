/**
 * Our contracts on Base Sepolia. Written by `pnpm --filter @sqw/cosigner deploy:base`.
 */
export const DEPLOYMENTS = {
  chainId: 84532,
  accountImplementation: "0x904A17B5549A3D10DAB11763c78dCb38edB27b12",
  factory: "0x358afcB62b5F7aCEB91ED56621704EFd12239270",
  /** Factories of earlier account versions: safes created with them keep working, without apps. */
  legacyFactories: ["0x101b9D7Ca9A55878D8ee39a94eF1b240Af673867"] as `0x${string}`[],
  paymaster: "0x325A7E0Ae8adBAeba04Cce4e095B2D11c9e6ABbB",
  /** Swissquote: paymaster signer and recipient of Standard-plan USDC fees. */
  swissquote: "0xfd0108F7F5bbb4c35Ef5D7021B08F62D6CE3dF97",
  /** Swissquote-vetted DeFi app adapters. */
  adapters: {
    uniswap: "0x97242fc04eff425C083F5c1773612aC135BA1433",
    aave: "0xd6041Fe2463687385854866E7e80e28EB06b2Ad5",
  },
} as const;
