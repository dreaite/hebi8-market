import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Node-only market data clients: load them with native require instead of bundling.
  serverExternalPackages: ["better-sqlite3", "yahoo-finance2", "@mathieuc/tradingview"],
};

export default nextConfig;
