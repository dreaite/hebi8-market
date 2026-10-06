import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/series";
import { evalSynth, parseSynth } from "@/lib/synth";

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const bar = (iso: string, o: number, h: number, l: number, c: number): Bar => ({ t: day(iso), o, h, l, c, v: 1, adj: 1 });

const aliases = { BTC: "binance:BTCUSDT", GOLD: "tv:TVC:GOLD" };

describe("parseSynth", () => {
  it("collects operands from aliases and quoted keys, in order", () => {
    expect(parseSynth("BTC/GOLD", aliases).keys).toEqual(["binance:BTCUSDT", "tv:TVC:GOLD"]);
    expect(parseSynth('"yahoo:SPY" - 2 * GOLD', aliases).keys).toEqual(["yahoo:SPY", "tv:TVC:GOLD"]);
  });

  it.each([
    ["BTC/NOPE", "未知别名「NOPE」"],
    ['"bad key"', "无效的标的 key"],
    ["BTC +", "表达式不完整"],
    ["(BTC", "缺少「)」"],
    ["BTC GOLD", "表达式多了内容"],
    ["1 + 2", "至少要引用一个标的"],
    ["BTC % 2", "无法识别的字符"],
  ])("rejects %j", (expr, message) => {
    expect(() => parseSynth(expr, aliases)).toThrow(message);
  });
});

describe("evalSynth", () => {
  const btc = [bar("2026-01-03", 100, 110, 90, 105), bar("2026-01-04", 105, 120, 100, 110), bar("2026-01-05", 110, 115, 95, 100)];
  const gold = [bar("2026-01-05", 10, 11, 9, 10), bar("2026-01-06", 10, 12, 9.5, 11)];

  it("computes each OHLC field separately on the first operand's trading days", () => {
    const out = evalSynth(parseSynth("BTC/GOLD", aliases), { "binance:BTCUSDT": btc, "tv:TVC:GOLD": gold });
    // gold starts on the 5th, so the earlier BTC days are dropped; 115/11 and 95/9 sit inside
    // the open/close, so the candle's high/low are widened to the open and close
    expect(out).toEqual([{ t: day("2026-01-05"), o: 11, h: 11, l: 10, c: 10, v: null, adj: 1 }]);
    const [raw] = evalSynth(parseSynth("BTC*GOLD", aliases), { "binance:BTCUSDT": btc, "tv:TVC:GOLD": gold });
    expect(raw).toEqual({ t: day("2026-01-05"), o: 1100, h: 115 * 11, l: 95 * 9, c: 1000, v: null, adj: 1 });
  });

  it("forward-fills operands that did not trade and supports numbers and precedence", () => {
    const base = [bar("2026-01-05", 1, 1, 1, 1), bar("2026-01-06", 1, 1, 1, 1), bar("2026-01-07", 1, 1, 1, 1)];
    const out = evalSynth(parseSynth('2 * "yahoo:SPY" + GOLD ^ 2', aliases), { "yahoo:SPY": base, "tv:TVC:GOLD": gold });
    expect(out.map((b) => b.c)).toEqual([2 + 100, 2 + 121, 2 + 121]);
    expect(out.map((b) => b.t)).toEqual(base.map((b) => b.t));
  });

  it("keeps candles well-formed when ratios of highs and lows cross", () => {
    const a = [bar("2026-01-05", 10, 20, 5, 10)];
    const b = [bar("2026-01-05", 1, 10, 0.5, 1)];
    const [out] = evalSynth(parseSynth('"yahoo:A"/"yahoo:B"', {}), { "yahoo:A": a, "yahoo:B": b });
    expect(out.h).toBeGreaterThanOrEqual(Math.max(out.o, out.c));
    expect(out.l).toBeLessThanOrEqual(Math.min(out.o, out.c));
  });

  it("returns nothing when an operand has no data", () => {
    expect(evalSynth(parseSynth("BTC/GOLD", aliases), { "binance:BTCUSDT": btc })).toEqual([]);
  });
});
