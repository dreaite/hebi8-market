import { describe, expect, it } from "vitest";
import { calcDrawdown, calcRelativeStrength, sma } from "@/indicators/calc";
import { drawdown, relativeStrength } from "@/indicators/custom";
import type { KLineData } from "klinecharts";

describe("sma", () => {
  it("averages a full window and is undefined before", () => {
    expect(sma([1, 2, 3, 4], 2)).toEqual([undefined, 1.5, 2.5, 3.5]);
  });

  it("restarts after gaps", () => {
    expect(sma([undefined, 2, 4, 6], 2)).toEqual([undefined, undefined, 3, 5]);
  });
});

describe("calcDrawdown", () => {
  it("measures the distance from the running peak", () => {
    expect(calcDrawdown([100, 50, 75, 120, 90])).toEqual([0, -50, -25, 0, -25]);
  });
});

describe("calcRelativeStrength", () => {
  it("rebases the price/benchmark ratio to 100", () => {
    const out = calcRelativeStrength([10, 22, 30], [100, 200, 200], 2);
    const round = (v: number | undefined) => (v === undefined ? v : Math.round(v * 1e9) / 1e9);
    expect(out.map((p) => round(p.rs))).toEqual([100, 110, 150]);
    expect(out.map((p) => round(p.rsma))).toEqual([undefined, 105, 130]);
  });

  it("starts at the first bar with benchmark data", () => {
    const out = calcRelativeStrength([5, 10, 20], [undefined, 100, 100], 1);
    expect(out.map((p) => p.rs)).toEqual([undefined, 100, 200]);
  });
});

describe("KLineChart templates", () => {
  const data: KLineData[] = [
    { timestamp: 1, open: 1, high: 1, low: 1, close: 10, bench: 100 },
    { timestamp: 2, open: 1, high: 1, low: 1, close: 5, bench: 100 },
  ];

  it("DD reads closes", async () => {
    expect(await drawdown.calc(data, drawdown as never)).toEqual([{ dd: 0 }, { dd: -50 }]);
  });

  it("RS reads the bench field attached by /api/bars", async () => {
    const result = await relativeStrength.calc(data, { calcParams: [1] } as never);
    expect(result.map((p) => p.rs)).toEqual([100, 50]);
  });
});
