/** Read path: bars for any key, synthetic ones included. Never touches the network. */
import type { RefSeries } from "@/indicators/formula";
import type { BarsTail, ChartBar } from "./api-types";
import { findItem, type Config } from "./config";
import { aggregate, align, applyPrices, type Bar, type Prices } from "./series";
import { readDaily } from "./store";
import { isSynthetic, type Timeframe } from "./symbols";
import { evalSynth, parseSynth } from "./synth";

/** Where daily bars come from: the cache, or for price alerts the cache plus today's bar from the latest quote. */
export type DailyReader = (key: string) => Bar[];

export function loadDaily(key: string, prices: Prices, cfg: Config, read: DailyReader = readDaily): Bar[] {
  if (!isSynthetic(key)) return applyPrices(read(key), prices);
  const synth = parseSynth(key.slice(1), cfg.aliases);
  const series = Object.fromEntries(synth.keys.map((k) => [k, applyPrices(read(k), prices)]));
  return evalSynth(synth, series);
}

/** Why a synthetic key has no bars: each operand without any, with its sync error. */
export function synthNoData(key: string, cfg: Config, syncError: (key: string) => string | null, read: DailyReader = readDaily): string {
  const missing = parseSynth(key.slice(1), cfg.aliases).keys.filter((k) => read(k).length === 0);
  if (missing.length === 0) return "各操作数的日期没有重叠";
  return missing.map((k) => `${k}：${syncError(k) ?? "暂无数据，等待同步"}`).join("；");
}

export function loadSeries(key: string, tf: Timeframe, prices: Prices, cfg: Config, read: DailyReader = readDaily): Bar[] {
  return aggregate(loadDaily(key, prices, cfg, read), tf);
}

/** Other symbols aligned to `bars`, as the columns the formula engine and the chart consume. */
export function loadRefs(bars: Bar[], keys: string[], tf: Timeframe, prices: Prices, cfg: Config, read: DailyReader = readDaily): Record<string, RefSeries> {
  const refs: Record<string, RefSeries> = {};
  for (const key of new Set(keys)) {
    let other: Bar[];
    try {
      other = loadSeries(key, tf, prices, cfg, read);
    } catch {
      continue;
    }
    const aligned = align(bars, other);
    refs[key] = {
      o: aligned.map((b) => b?.o ?? null),
      h: aligned.map((b) => b?.h ?? null),
      l: aligned.map((b) => b?.l ?? null),
      c: aligned.map((b) => b?.c ?? null),
      v: aligned.map((b) => b?.v ?? null),
    };
  }
  return refs;
}

/** Trim float noise from adjusted prices to keep the payload small. */
const round = (x: number) => Number(x.toPrecision(8));

export interface ChartData {
  daily: Bar[];
  bars: ChartBar[];
  refs: Record<string, RefSeries>;
}

/** What the chart draws for a key: its bars on a timeframe with the benchmark's close, and the other symbols aligned to them. */
export function loadChart(key: string, tf: Timeframe, prices: Prices, withKeys: string[], cfg: Config, read: DailyReader = readDaily): ChartData {
  const daily = loadDaily(key, prices, cfg, read);
  const bench = findItem(cfg, key)?.bench ?? null;
  const series = aggregate(daily, tf);
  const refs = loadRefs(series, [...withKeys, ...(bench && bench !== key ? [bench] : [])], tf, prices, cfg, read);
  const benchCloses = bench ? refs[bench]?.c : undefined;
  const bars = series.map((b, i) => ({
    timestamp: b.t * 1000,
    open: round(b.o),
    high: round(b.h),
    low: round(b.l),
    close: round(b.c),
    volume: b.v ?? undefined,
    bench: benchCloses?.[i] != null ? round(benchCloses[i]!) : undefined,
  }));
  return { daily, bars, refs };
}

/** The last bar of a chart and the other symbols at it, for updating an open chart after a quote round. */
export function chartTail({ daily, bars, refs }: ChartData): BarsTail | null {
  const i = bars.length - 1;
  if (i < 0) return null;
  return {
    bar: bars[i],
    refs: Object.fromEntries(Object.entries(refs).map(([k, r]) => [k, { o: r.o?.[i] ?? null, h: r.h?.[i] ?? null, l: r.l?.[i] ?? null, c: r.c[i], v: r.v?.[i] ?? null }])),
    lastDay: daily[daily.length - 1].t * 1000,
  };
}
