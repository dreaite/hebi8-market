/**
 * Drawings from a real TradingView layout (fixtures/tv-sources.json: one of each kind the layout
 * had, as `get/layout/…/sources` returns them, fields the conversion does not read taken out).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertDrawing, parseTvSources, sessionMinutes, tickOf, type DrawingContext } from "@/lib/tv-drawings";
import { isTvSymbol } from "@/lib/tv-import";

const DAY = 86400;
const drawings = parseTvSources(fs.readFileSync(path.join(__dirname, "fixtures", "tv-sources.json"), "utf8"));
const byId = Object.fromEntries(drawings.map((d) => [d.id, d]));

/** A synced cache up to 2026-10-08: every day for crypto, weekdays for the rest (holidays left out of the picture). */
function contextFor(symbol: string): DrawingContext {
  const crypto = /^(BINANCE|BYBIT):/.test(symbol);
  const days: number[] = [];
  for (let t = Date.UTC(2010, 0, 1) / 1000; t <= Date.UTC(2026, 9, 8) / 1000; t += DAY) {
    const wd = new Date(t * 1000).getUTCDay();
    if (crypto || (wd !== 0 && wd !== 6)) days.push(t);
  }
  const timeZone = crypto ? "UTC" : symbol.startsWith("SSE:") ? "Asia/Shanghai" : "America/New_York";
  return { days, timeZone, sessionMinutes: sessionMinutes(symbol), tick: 0.01 };
}

const convert = (id: string) => {
  const d = byId[id];
  const r = convertDrawing(d, contextFor(d.symbol));
  return r.ok ? [r.overlay.name, r.overlay.points.map((p) => [new Date(p.timestamp).toISOString().slice(0, 10), Number(p.value.toFixed(4))])] : r.reason;
};

describe("a real layout's drawings", () => {
  it("reads the stored format: type and points in `state`, styles in `state.state`", () => {
    expect(drawings).toHaveLength(15);
    expect(byId.CokSCP).toMatchObject({
      symbol: "AMEX:GLD",
      type: "LineToolTrendLine",
      points: [
        { time_t: 1760981400, price: 403.2250915921136, interval: "240" },
        { time_t: 1764081000, offset: 25, price: 370.1670316037478, interval: "240" },
      ],
      state: { linecolor: "rgba(41, 98, 255, 1)", linewidth: 2, linestyle: 0, extendLeft: false, extendRight: false },
    });
    // a point without an interval takes the drawing's
    expect(byId.ExR8Lv.points[0].interval).toBe("60");
  });

  it("converts each kind, points on the trading days", () => {
    expect(convert("v1WgAe")).toEqual(["segment", [["2024-03-13", 4082.58], ["2024-05-21", 3147.2259]]]); // 1D, 23 bars past the last one
    expect(convert("yBic3F")).toEqual(["rect", [["2024-03-25", 315.4923], ["2026-12-14", 298.3185]]]); // 1W, 60 weeks
    expect(convert("pc59Wh")).toEqual(["horizontalStraightLine", [["2024-01-01", 93576]]]); // 12M
    expect(convert("scJOBL")).toEqual(["fibonacciLine", [["2015-07-13", 54.1936], ["2028-08-14", 16.069]]]);
    // FX: a daily bar stamped 17:00 New York is the next day's
    expect(convert("8mOqp4")).toEqual(["fibExtension", [["2026-04-22", 23.4767], ["2026-05-05", 22.7339], ["2026-07-06", 23.7318]]]);
    expect(convert("HE8uhV")).toEqual(["text", [["2026-03-16", 129.4647]]]);
    expect(convert("QJnGxR")).toEqual(["horizontalRayLine", [["1981-02-02", 203.15], ["1981-05-13", 203.15]]]);
    expect(convert("ho1k65")).toEqual([
      "headShoulders",
      [
        ["1998-06-01", 146.79],
        ["2004-08-02", 98.5359],
        ["2007-05-01", 121.98],
        ["2011-10-03", 75.565],
        ["2015-05-01", 124.461],
        ["2021-01-01", 102.591],
        ["2024-06-03", 160.835],
      ],
    ]);
    expect(convert("6VPuED")).toEqual(["arrow", [["2023-10-16", 1556.93], ["2026-06-29", 3769.8956]]]);
    expect(convert("ExR8Lv")).toBe("没有对应的工具：LineToolFixedRangeVolumeProfile");
  });

  it("turns intraday offsets into trading days, roughly", () => {
    // 4h on a US stock: 25 bars × 240 min / 390 min a day → 16 trading days after Nov 25
    expect(convert("CokSCP")).toEqual(["segment", [["2025-10-20", 403.2251], ["2025-12-17", 370.167]]]);
    // 15 min on crypto: 118 × 15 / 1440 → 2 days
    expect(convert("HDb2sy")).toEqual(["segment", [["2024-04-04", 1.1657], ["2024-04-07", 1.2352]]]);
  });

  it("puts a position's levels, kept in ticks, at prices", () => {
    expect(byId.I59nN0.state).toMatchObject({ stopLevel: 88, profitLevel: 1473 });
    // entry 8.53, tick 0.01: target + 14.73, stop − 0.88; the right edge is the second point
    expect(convert("I59nN0")).toEqual(["longPosition", [["2027-11-10", 8.53], ["2031-05-14", 23.26], ["2031-05-14", 7.65]]]);
    expect(convertDrawing(byId.I59nN0, { ...contextFor("SSE:601985"), tick: null })).toEqual({ ok: false, reason: "没有 K 线，算不出最小变动价位" });
  });

  it("reads a curve's third point as its control point", () => {
    // control (2026-02-06, 29.66) under the chord: the app's middle point is halfway to the chord's middle
    expect(convert("Bh6G3N")).toEqual(["curve", [["2024-02-02", 21.668], ["2026-05-22", 59.7573], ["2025-09-01", 35.1855]]]);
  });

  it("tells an expression of symbols from a listing", () => {
    expect(byId.xMPC0k.symbol).toBe("1/FX:USDJPY*TVC:DXY");
    expect(isTvSymbol(byId.xMPC0k.symbol)).toBe(false);
    expect(drawings.filter((d) => d.id !== "xMPC0k").every((d) => isTvSymbol(d.symbol))).toBe(true);
  });
});

describe("tickOf / sessionMinutes", () => {
  it("finds the price step of the closes, Yahoo's float32 noise included", () => {
    expect(tickOf([8.53, 8.6, 8.47])).toBe(0.01);
    expect(tickOf([186.5800018310547, 190.1199951171875])).toBe(0.01);
    expect(tickOf([146.791, 147.2])).toBe(0.001);
    expect(tickOf([64000, 64100])).toBe(1);
    expect(tickOf([])).toBeNull();
  });

  it("knows which exchanges close overnight", () => {
    expect(sessionMinutes("AMEX:GLD")).toBe(390);
    expect(sessionMinutes("SSE:601985")).toBe(240);
    expect(sessionMinutes("HKEX:700")).toBe(330);
    expect(sessionMinutes("BINANCE:BTCUSDT")).toBe(1440);
    expect(sessionMinutes("FX:USDJPY")).toBe(1440);
  });
});
