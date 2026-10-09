import { execFileSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json";

/** The commit this build came from; "unknown" outside a git checkout. */
function gitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  // Node-only market data clients: load them with native require instead of bundling.
  serverExternalPackages: ["better-sqlite3", "yahoo-finance2", "@mathieuc/tradingview"],
  // TradingView drawings go back with the import's confirmation; a layout full of brush strokes passes 1 MB
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  // the service worker is checked for updates on every load, never served from the HTTP cache
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
  // Shown in the help panel and attached to in-app feedback; inlined on both server and client.
  env: {
    HEBI8_VERSION: pkg.version,
    HEBI8_COMMIT: gitCommit(),
    HEBI8_BUILT_AT: new Date().toISOString(),
  },
};

export default nextConfig;
