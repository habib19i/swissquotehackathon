import type { NextConfig } from "next";

// One .env at the repo root serves the app and both services.
try {
  process.loadEnvFile("../../.env");
} catch {
  // No root .env: defaults below apply.
}

const COSIGNER_URL = process.env.COSIGNER_URL ?? "http://localhost:4001";
const RECOVERY_URL = process.env.RECOVERY_URL ?? "http://localhost:4002";

const nextConfig: NextConfig = {
  // The workspace packages ship TypeScript source.
  transpilePackages: ["@sqw/shared", "@sqw/mpc", "@sqw/bitcoin"],

  // The phone reaches both key-share holders through this origin, so the app works over https on a
  // real phone without CORS or mixed content. The proxy only forwards; shares stay in each service.
  async rewrites() {
    return [
      { source: "/svc/cosigner/:path*", destination: `${COSIGNER_URL}/:path*` },
      { source: "/svc/recovery/:path*", destination: `${RECOVERY_URL}/:path*` },
    ];
  },

  // Lets a phone on the same network open the dev server (e.g. https://192.168.1.20:3000).
  allowedDevOrigins: (process.env.DEV_ORIGINS ?? "").split(",").filter(Boolean),
};

export default nextConfig;
