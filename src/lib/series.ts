import type { Timeframe } from "./symbols";
import { DAY } from "./time";

export interface Bar {
  /** Unix seconds at UTC midnight of the trading day (or of the week/month start) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
}

/** Sort by time and keep the last bar for each timestamp. */
export function dedupeBars(bars: Bar[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const bar of bars) byTime.set(bar.t, bar);
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

export function bucketStart(t: number, tf: Timeframe): number {
  if (tf === "D") return t;
  const date = new Date(t * 1000);
  if (tf === "W") {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return t - daysSinceMonday * DAY;
  }
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 1000;
}

/** Aggregate ascending daily bars into weekly (Monday-start) or monthly bars. */
export function aggregate(daily: Bar[], tf: Timeframe): Bar[] {
  if (tf === "D") return daily;
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const bar of daily) {
    const t = bucketStart(bar.t, tf);
    if (!cur || cur.t !== t) {
      cur = { ...bar, t };
      out.push(cur);
      continue;
    }
    cur.h = Math.max(cur.h, bar.h);
    cur.l = Math.min(cur.l, bar.l);
    cur.c = bar.c;
    cur.v = cur.v === null && bar.v === null ? null : (cur.v ?? 0) + (bar.v ?? 0);
  }
  return out;
}

/**
 * For each bar, the benchmark close at the same time or the latest one before it
 * (benchmarks may trade on different days, e.g. crypto vs. stocks).
 */
export function alignCloses(bars: Bar[], benchmark: Bar[]): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let j = 0;
  let last: number | undefined;
  for (const bar of bars) {
    while (j < benchmark.length && benchmark[j].t <= bar.t) {
      last = benchmark[j].c;
      j++;
    }
    out.push(last);
  }
  return out;
}

/** Close of the latest bar at or before `t`, via binary search over ascending bars. */
export function closeAtOrBefore(bars: Bar[], t: number): number | undefined {
  let lo = 0;
  let hi = bars.length - 1;
  let found: number | undefined;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) {
      found = bars[mid].c;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
