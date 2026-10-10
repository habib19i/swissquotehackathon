import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@sqw/shared"],
};

export default nextConfig;
