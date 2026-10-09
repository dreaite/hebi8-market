import { describe, expect, it } from "vitest";
import type { AxisRange } from "klinecharts";
import { LOG_AXIS } from "@/components/log-axis";

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
