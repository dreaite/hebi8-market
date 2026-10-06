import { compile, evaluate, type OhlcvBar } from "@/indicators/formula";
import { describeError } from "@/indicators/formula-indicators";
import { loadRefs, loadSeries } from "./bars";
import { findItem, type Config } from "./config";
import type { Bar } from "./series";
import type { ConditionResult } from "./stats";
import type { Timeframe } from "./symbols";

export const toOhlcv = (bars: Bar[]): OhlcvBar[] =>
  bars.map((b) => ({ open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v ?? undefined }));

const flag = (v: number | undefined): boolean | null => (v === undefined || Number.isNaN(v) ? null : v !== 0);

/** Series per timeframe for one key, loaded once and shared by every rule on that key. */
export type SeriesCache = Map<Timeframe, Bar[]>;

/** One boolean formula on the last two bars of `tf`; `t` is the time of the last bar. */
export function evalRule(key: string, formula: string, tf: Timeframe, cfg: Config, cache: SeriesCache = new Map()): ConditionResult {
  try {
    const program = compile(formula, { aliases: cfg.aliases, bench: findItem(cfg, key)?.bench ?? null });
    let bars = cache.get(tf);
    if (!bars) {
      bars = loadSeries(key, tf, cfg.prices, cfg);
      cache.set(tf, bars);
    }
    const refs = loadRefs(bars, program.refs, tf, cfg.prices, cfg);
    const line = evaluate(program, { bars: toOhlcv(bars), refs }).at(-1)!;
    const t = bars.at(-1)?.t;
    return { now: flag(line.at(-1)), prev: flag(line.at(-2)), ...(t !== undefined ? { t } : {}) };
  } catch (err) {
    return { now: null, prev: null, error: describeError(err) };
  }
}

/** Every condition for one symbol, on the last two bars of the condition's timeframe (weekly by default). */
export function evalConditions(key: string, cfg: Config): Record<string, ConditionResult> {
  const cache: SeriesCache = new Map();
  return Object.fromEntries(cfg.conditions.map((cond) => [cond.id, evalRule(key, cond.formula, cond.tf, cfg, cache)]));
}
