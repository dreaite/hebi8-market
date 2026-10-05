import { adapters } from "./sources";
import { getSymbol, latestBarTime, markSyncError, markSynced, writeBars } from "./store";

/** Long-term view: daily bars are plenty fresh if fetched within the last few hours. */
const STALE_MS = 6 * 3600 * 1000;

export interface SyncOutcome {
  key: string;
  ok: boolean;
  skipped?: boolean;
  bars?: number;
  error?: string;
}

const inflight = new Map<string, Promise<SyncOutcome>>();

async function run(key: string, force: boolean): Promise<SyncOutcome> {
  const meta = getSymbol(key);
  if (!meta) return { key, ok: false, error: "unknown symbol" };
  if (!force && meta.syncedAt && Date.now() - meta.syncedAt < STALE_MS) {
    return { key, ok: true, skipped: true };
  }
  try {
    const since = latestBarTime(key);
    const result = await adapters[meta.source].fetchDaily(meta.ticker, since);
    if (result.bars.length === 0 && since === null) throw new Error("no data returned");
    writeBars(key, result.bars, result.mode);
    markSynced(key, result.name);
    return { key, ok: true, bars: result.bars.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markSyncError(key, message);
    return { key, ok: false, error: message };
  }
}

/** Fetch new bars for a symbol unless it was synced recently. Never throws. */
export function syncSymbol(key: string, force = false): Promise<SyncOutcome> {
  let job = inflight.get(key);
  if (!job) {
    job = run(key, force).finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return job;
}

export async function syncMany(keys: string[], force = false, concurrency = 4): Promise<SyncOutcome[]> {
  const queue = [...new Set(keys)];
  const results: SyncOutcome[] = [];
  const worker = async () => {
    for (let key = queue.shift(); key; key = queue.shift()) {
      results.push(await syncSymbol(key, force));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return results;
}
