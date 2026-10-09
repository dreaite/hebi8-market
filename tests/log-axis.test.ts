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
  const ticks = (lo: number, hi: number, precision: number) => logTicks(Math.log10(lo), Math.log10(hi), 650, precision);
  const texts = (lo: number, hi: number, precision: number) => ticks(lo, hi, precision).map((t) => t.text);

  it("steps by round numbers sized to where they are, labelled at the symbol's precision", () => {
    expect(texts(0.4, 0.96, 5)).toEqual(["0.45000", "0.50000", "0.55000", "0.60000", "0.65000", "0.70000", "0.80000", "0.90000"]);
    expect(texts(0.08, 0.56, 5)).toEqual(["0.10000", "0.12000", "0.15000", "0.20000", "0.25000", "0.30000", "0.40000", "0.50000"]);
    expect(texts(0.000004, 0.000046, 8)).toEqual(["0.0{5}600", "0.0{5}800", "0.0{4}1000", "0.0{4}1500", "0.0{4}2000", "0.0{4}3000", "0.0{4}4000"]);
  });

  it("keeps the 1, 2 and 5 of each decade across a few decades, and powers of ten across many", () => {
    expect(texts(100, 64000, 2)).toEqual(["200.00", "500.00", "1,000.00", "2,000.00", "5,000.00", "10,000.00", "20,000.00", "50,000.00"]);
    expect(texts(0.0012, 64000, 2)).toEqual(["0.01", "0.10", "1.00", "10.00", "100.00", "1,000.00", "10,000.00"]);
  });

  it("falls back to even steps on a narrow range", () => {
    expect(texts(600, 620, 2)).toEqual(["602.50", "605.00", "607.50", "610.00", "612.50", "615.00", "617.50"]);
  });

  it("moves to a bigger step at the multiple of it nearest one stride up", () => {
    expect(texts(1892, 207970, 2)).toEqual(["4,000.00", "10,000.00", "20,000.00", "40,000.00", "100,000.00"]);
    expect(texts(0.35, 1.2, 5)).toEqual(["0.40000", "0.45000", "0.50000", "0.60000", "0.70000", "0.80000", "0.90000", "1.00000"]);
  });

  it("drops ticks the precision cannot show exactly", () => {
    expect(texts(600, 620, 0)).toEqual(["605", "610", "615"]);
    expect(texts(0.000004, 0.000046, 5)).toEqual(["0.0{4}1", "0.0{4}2", "0.0{4}3", "0.0{4}4"]);
  });

  it("places each tick on the log scale, apart and clear of the edges", () => {
    for (const [lo, hi] of [[0.4, 0.96], [0.08, 0.56], [0.000004, 0.000046], [100, 64000], [3, 126000], [600, 620], [1892, 207970], [1, 5]]) {
      const t = ticks(lo, hi, 8);
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
