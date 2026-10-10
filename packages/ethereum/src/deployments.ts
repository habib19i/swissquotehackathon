/**
 * Our contracts on Base Sepolia. Written by `pnpm --filter @sqw/cosigner deploy:base`.
 */
export const DEPLOYMENTS = {
  chainId: 84532,
  accountImplementation: "0x12055a9C83D6590571B1e3125F8382958830C0Fa",
  factory: "0x101b9D7Ca9A55878D8ee39a94eF1b240Af673867",
  paymaster: "0x325A7E0Ae8adBAeba04Cce4e095B2D11c9e6ABbB",
  /** Swissquote: paymaster signer and recipient of Standard-plan USDC fees. */
  swissquote: "0xfd0108F7F5bbb4c35Ef5D7021B08F62D6CE3dF97",
} as const;
