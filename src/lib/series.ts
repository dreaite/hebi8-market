import type { Timeframe } from "./symbols";
import { DAY } from "./time";

export interface Bar {
  /** Unix seconds at UTC midnight of the trading day (or of the week/month/quarter start) */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  /** Dividend adjustment factor; o/h/l/c are split-adjusted only, total return = price × adj */
  adj: number;
}

export type Prices = "split" | "total";

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
  const month = date.getUTCMonth();
  return Date.UTC(date.getUTCFullYear(), tf === "Q" ? Math.floor(month / 3) * 3 : month, 1) / 1000;
}

/** Aggregate ascending daily bars into weekly (Monday-start), monthly or quarterly bars. */
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
    cur.adj = bar.adj;
    cur.v = cur.v === null && bar.v === null ? null : (cur.v ?? 0) + (bar.v ?? 0);
  }
  return out;
}

/** `total` folds dividends into the prices; `split` returns the bars untouched. */
export function applyPrices(bars: Bar[], prices: Prices): Bar[] {
  if (prices !== "total") return bars;
  return bars.map((b) =>
    b.adj === 1 ? b : { ...b, o: b.o * b.adj, h: b.h * b.adj, l: b.l * b.adj, c: b.c * b.adj, adj: 1 },
  );
}

/**
 * For each target bar, the other series' bar on the same day or the latest one before it
 * (forward fill: crypto trades on days stocks do not). Null before the other series starts.
 */
export function align(target: Bar[], other: Bar[]): (Bar | null)[] {
  const out: (Bar | null)[] = [];
  let j = 0;
  let last: Bar | null = null;
  for (const bar of target) {
    while (j < other.length && other[j].t <= bar.t) last = other[j++];
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
