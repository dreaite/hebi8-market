import { describe, expect, it } from "vitest";
import type { AxisRange } from "klinecharts";
import { LOG_AXIS, logTicks } from "@/components/log-axis";

const toReal = (v: number) => LOG_AXIS.valueToRealValue!(v, { range: {} as AxisRange });
const toValue = (v: number) => LOG_AXIS.realValueToValue!(v, { range: {} as AxisRange });
const toDisplay = (v: number) => LOG_AXIS.realValueToDisplayValue!(v, { range: {} as AxisRange });

describe("log axis", () => {
  it("brings prices below 1 back out of log space as they went in", () => {
    for (const price of [0.0012, 0.65, 1, 3.5, 182.4, 64000]) {
      expect(toValue(toReal(price)) / price).toBeCloseTo(1, 12);
      expect(toDisplay(toReal(price)) / price).toBeCloseTo(1, 12);
    }
    expect(toDisplay(Math.log10(0.65))).toBeCloseTo(0.65, 10);
  });

  it("puts the range in log space and keeps the prices", () => {
    const r = { from: 0.001, to: 0.01, range: 0.009, realFrom: 0.001, realTo: 0.01, realRange: 0.009, displayFrom: 0.001, displayTo: 0.01, displayRange: 0.009 };
    const range = LOG_AXIS.createRange!({ defaultRange: r } as Parameters<NonNullable<typeof LOG_AXIS.createRange>>[0]);
    expect(range).toMatchObject({ from: 0.001, to: 0.01, displayFrom: 0.001, displayTo: 0.01 });
    expect(range.realFrom).toBeCloseTo(-3, 10);
    expect(range.realTo).toBeCloseTo(-2, 10);
    expect(range.realRange).toBeCloseTo(1, 10);
  });
});

describe("log axis ticks", () => {
  const ticks = (lo: number, hi: number) => logTicks(Math.log10(lo), Math.log10(hi), 650);
  const texts = (lo: number, hi: number) => ticks(lo, hi).map((t) => t.text);

  it("steps by round numbers sized to where they are", () => {
    expect(texts(0.4, 0.96)).toEqual(["0.45", "0.50", "0.55", "0.60", "0.65", "0.7", "0.8", "0.9"]);
    expect(texts(0.08, 0.56)).toEqual(["0.10", "0.12", "0.15", "0.20", "0.25", "0.30", "0.4", "0.5"]);
    expect(texts(0.000004, 0.000046)).toEqual(["0.0{5}6", "0.0{5}8", "0.0{4}10", "0.0{4}15", "0.0{4}20", "0.0{4}3", "0.0{4}4"]);
  });

  it("keeps the 1, 2 and 5 of each decade across a few decades, and powers of ten across many", () => {
    expect(texts(100, 64000)).toEqual(["200", "500", "1,000", "2,000", "5,000", "10,000", "20,000", "50,000"]);
    expect(texts(0.0012, 64000)).toEqual(["0.01", "0.1", "1", "10", "100", "1,000", "10,000"]);
  });

  it("falls back to even steps on a narrow range", () => {
    expect(texts(600, 620)).toEqual(["602.5", "605.0", "607.5", "610.0", "612.5", "615.0", "617.5"]);
  });

  it("moves to a bigger step at the multiple of it nearest one stride up", () => {
    expect(texts(1892, 207970)).toEqual(["4,000", "10,000", "20,000", "40,000", "100,000"]);
    expect(texts(0.35, 1.2)).toEqual(["0.40", "0.45", "0.5", "0.6", "0.7", "0.8", "0.9", "1.0"]);
  });

  it("places each tick on the log scale, apart and clear of the edges", () => {
    for (const [lo, hi] of [[0.4, 0.96], [0.08, 0.56], [0.000004, 0.000046], [100, 64000], [3, 126000], [600, 620], [1892, 207970], [1, 5]]) {
      const t = ticks(lo, hi);
      const realFrom = Math.log10(lo);
      const realRange = Math.log10(hi) - realFrom;
      t.forEach(({ coord, value }, i) => {
        expect(coord).toBe(Math.round((1 - (Math.log10(+value) - realFrom) / realRange) * 650));
        expect(coord).toBeGreaterThan(11);
        expect(coord).toBeLessThan(650 - 11);
        if (i > 0) expect(t[i - 1].coord - coord).toBeGreaterThanOrEqual(22);
      });
    }
  });
});
