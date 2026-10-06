import { loadDaily } from "./bars";
import { evalConditions } from "./conditions";
import { allItems, syncKeys, type Config } from "./config";
import { adapters } from "./sources";
import { computeStats } from "./stats";
import { ensureSymbol, getSymbol, latestBarTime, listSymbols, markSyncError, markSynced, writeBars, writeStats } from "./store";
import { parseKey } from "./symbols";
import { compareKeys, readConfig, readConfigSafe } from "./vault";

/** Without `force`, a symbol synced this recently is left alone. */
const FRESH_MS = 60 * 60 * 1000;

export interface SyncOutcome {
  key: string;
  ok: boolean;
  skipped?: boolean;
  bars?: number;
  error?: string;
}

const inflight = new Map<string, Promise<SyncOutcome>>();
let allInFlight: Promise<SyncOutcome[]> | null = null;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function run(key: string, force: boolean): Promise<SyncOutcome> {
  let source, ticker;
  try {
    ({ source, ticker } = parseKey(key));
  } catch (err) {
    return { key, ok: false, error: message(err) };
  }
  ensureSymbol(key);
  const meta = getSymbol(key)!;
  if (!force && meta.syncedAt && Date.now() - meta.syncedAt < FRESH_MS) return { key, ok: true, skipped: true };
  try {
    const since = latestBarTime(key);
    const result = await adapters[source].fetchDaily(ticker, since);
    if (result.bars.length === 0 && since === null) throw new Error("no data returned");
    writeBars(key, result.bars, result.mode);
    markSynced(key, result.meta);
    return { key, ok: true, bars: result.bars.length };
  } catch (err) {
    markSyncError(key, message(err));
    return { key, ok: false, error: message(err) };
  }
}

/** Fetch new bars for one key; concurrent calls share the same job. Never throws. */
function fetchKey(key: string, force: boolean): Promise<SyncOutcome> {
  let job = inflight.get(key);
  if (!job) {
    job = run(key, force).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

async function syncMany(keys: string[], force: boolean, concurrency = 4): Promise<SyncOutcome[]> {
  const queue = [...new Set(keys)];
  const results: SyncOutcome[] = [];
  const worker = async () => {
    for (let key = queue.shift(); key; key = queue.shift()) results.push(await fetchKey(key, force));
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}

/** Stats for every watched symbol (synthetic ones included) and benchmark, from the cache only. */
export function recomputeStats(cfg: Config | null): void {
  if (!cfg) return;
  const symbols = listSymbols();
  const items = allItems(cfg);
  const keys = new Set([...items.map((i) => i.key), ...items.flatMap((i) => (i.bench ? [i.bench] : []))]);
  for (const key of keys) {
    try {
      const daily = loadDaily(key, cfg.prices, cfg);
      const conditions = daily.length ? evalConditions(key, cfg) : {};
      writeStats(key, computeStats(daily, { currency: symbols[key]?.currency ?? null, conditions }));
    } catch (err) {
      console.warn(`[hebi8] stats for ${key} failed: ${message(err)}`);
    }
  }
}

/** Sync one key and refresh stats; used when adding a symbol (the fetch doubles as validation). */
export async function syncOne(key: string, force = false): Promise<SyncOutcome> {
  const outcome = await fetchKey(key, force);
  recomputeStats(readConfigSafe().config);
  return outcome;
}

/** Everything the vault references, 4 at a time; concurrent callers share the run. */
export function syncAll(force = false): Promise<SyncOutcome[]> {
  if (allInFlight) return allInFlight;
  allInFlight = (async () => {
    const cfg = readConfig();
    const started = Date.now();
    const results = await syncMany(syncKeys(cfg, compareKeys()), force);
    recomputeStats(cfg);
    const failed = results.filter((r) => !r.ok);
    console.log(
      `[hebi8] synced ${results.length} symbols in ${((Date.now() - started) / 1000).toFixed(1)}s` +
        (failed.length ? `, failed: ${failed.map((r) => `${r.key} (${r.error})`).join(", ")}` : ""),
    );
    return results;
  })().finally(() => {
    allInFlight = null;
  });
  return allInFlight;
}
