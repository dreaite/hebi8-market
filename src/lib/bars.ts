/** Read path: bars for any key, synthetic ones included. Never touches the network. */
import type { RefSeries } from "@/indicators/formula";
import type { Config } from "./config";
import { aggregate, align, applyPrices, type Bar, type Prices } from "./series";
import { readDaily } from "./store";
import { isSynthetic, type Timeframe } from "./symbols";
import { evalSynth, parseSynth } from "./synth";

export function loadDaily(key: string, prices: Prices, cfg: Config): Bar[] {
  if (!isSynthetic(key)) return applyPrices(readDaily(key), prices);
  const synth = parseSynth(key.slice(1), cfg.aliases);
  const series = Object.fromEntries(synth.keys.map((k) => [k, applyPrices(readDaily(k), prices)]));
  return evalSynth(synth, series);
}

export function loadSeries(key: string, tf: Timeframe, prices: Prices, cfg: Config): Bar[] {
  return aggregate(loadDaily(key, prices, cfg), tf);
}

/** Other symbols aligned to `bars`, as the columns the formula engine and the chart consume. */
export function loadRefs(bars: Bar[], keys: string[], tf: Timeframe, prices: Prices, cfg: Config): Record<string, RefSeries> {
  const refs: Record<string, RefSeries> = {};
  for (const key of new Set(keys)) {
    let other: Bar[];
    try {
      other = loadSeries(key, tf, prices, cfg);
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
