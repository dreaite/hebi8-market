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

/** Every condition for one symbol, on the last two bars of the condition's timeframe (weekly by default). */
export function evalConditions(key: string, cfg: Config): Record<string, ConditionResult> {
  const bench = findItem(cfg, key)?.bench ?? null;
  const series = new Map<Timeframe, Bar[]>();
  const out: Record<string, ConditionResult> = {};
  for (const cond of cfg.conditions) {
    try {
      const program = compile(cond.formula, { aliases: cfg.aliases, bench });
      let bars = series.get(cond.tf);
      if (!bars) {
        bars = loadSeries(key, cond.tf, cfg.prices, cfg);
        series.set(cond.tf, bars);
      }
      const refs = loadRefs(bars, program.refs, cond.tf, cfg.prices, cfg);
      const line = evaluate(program, { bars: toOhlcv(bars), refs }).at(-1)!;
      out[cond.id] = { now: flag(line.at(-1)), prev: flag(line.at(-2)) };
    } catch (err) {
      out[cond.id] = { now: null, prev: null, error: describeError(err) };
    }
  }
  return out;
}
