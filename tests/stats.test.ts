import { describe, expect, it } from "vitest";
import { klineToBar } from "@/lib/sources/binance";
import { computeStats, pricePrecision } from "@/lib/stats";
import type { Bar } from "@/lib/series";

const DAY = 86400;
const start = Date.UTC(2024, 0, 1) / 1000;

/** Two years of daily bars rising linearly from 100, with one spike to 400 a year in. */
function series(): Bar[] {
  const bars: Bar[] = [];
  for (let i = 0; i <= 730; i++) {
    const c = i === 365 ? 400 : 100 + i * 0.1;
    bars.push({ t: start + i * DAY, o: c, h: c, l: c, c, v: 1, adj: 1 });
  }
  return bars;
}

describe("computeStats", () => {
  const stats = computeStats(series(), { currency: "USD" })!;

  it("reports the last close, currency and calendar-based changes", () => {
    expect(stats.last).toBeCloseTo(173);
    expect(stats.currency).toBe("USD");
    expect(stats.changes["1W"]).toBeCloseTo(173 / 172.3 - 1);
    expect(stats.changes["1Y"]).toBeCloseTo(173 / 400 - 1); // a year ago was the spike
  });

  it("measures YTD from the last close of the previous year", () => {
    // last bar is 2025-12-31 (day 730), so the reference is 2024-12-31 (day 365, the spike)
    expect(stats.changes.YTD).toBeCloseTo(173 / 400 - 1);
  });

  it("returns null for periods longer than the history", () => {
    expect(stats.changes["3Y"]).toBeNull();
    expect(stats.changes["5Y"]).toBeNull();
  });

  it("measures drawdown from the all-time-high close", () => {
    expect(stats.ddAth).toBeCloseTo(173 / 400 - 1);
  });

  it("places the last close in the 52-week range", () => {
    // the spike sits exactly 365 days back, outside the trailing window
    expect(stats.pos52).toBeCloseTo(1);
  });

  it("returns two years of weekly closes for the sparkline", () => {
    expect(stats.spark.length).toBeGreaterThan(100);
    expect(stats.spark.at(-1)).toBeCloseTo(173);
  });


  it("handles short and empty histories", () => {
    expect(computeStats([])).toBeNull();
    expect(computeStats(series().slice(0, 10))!.changes["1Y"]).toBeNull();
  });
});

describe("helpers", () => {
  it("maps Binance kline rows", () => {
    expect(klineToBar([1759622400000, "1.5", "2", "1", "1.8", "300", 0, "0"])).toEqual({
      t: 1759622400,
      o: 1.5,
      h: 2,
      l: 1,
      c: 1.8,
      v: 300,
      adj: 1,
    });
  });

  it("chooses price precision by magnitude", () => {
    expect(pricePrecision(85000)).toBe(2);
    expect(pricePrecision(5.33)).toBe(3);
    expect(pricePrecision(0.25)).toBe(5);
  });
});
