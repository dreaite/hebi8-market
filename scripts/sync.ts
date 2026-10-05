/**
 * Refresh every watchlist symbol and its benchmark. Meant for cron, e.g. daily after the US close:
 *   30 22 * * 1-5  cd ~/out/hebi8-market && npm run sync
 * Pass --force to ignore the 6h freshness window.
 */
import { ensureSymbol, listWatchlist } from "../src/lib/store";
import { syncMany } from "../src/lib/sync";

async function main() {
  const force = process.argv.includes("--force");
  const watchlist = listWatchlist();
  const keys = [
    ...watchlist.map((s) => s.key),
    ...watchlist.flatMap((s) => (s.benchmark ? [ensureSymbol(s.benchmark).key] : [])),
  ];
  const started = Date.now();
  const results = await syncMany(keys, force);
  for (const r of results) {
    const status = r.ok ? (r.skipped ? "fresh" : `${r.bars} bars`) : `FAILED ${r.error}`;
    console.log(`${r.key.padEnd(24)} ${status}`);
  }
  console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(results.some((r) => !r.ok) ? 1 : 0);
}

void main();
