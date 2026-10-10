import { describe, expect, it } from "vitest";
import { measureLines, pct, priceChangeText, volumeBetween } from "@/components/measure";

describe("price change", () => {
  it("signs the difference and the percentage of the first price", () => {
    expect(priceChangeText(100, 112.5, 2)).toBe("+12.50 (+12.50%)");
    expect(priceChangeText(200, 150, 2)).toBe("-50.00 (-25.00%)");
    expect(priceChangeText(1234.5, 2469, 1)).toBe("+1,234.5 (+100.00%)");
    expect(priceChangeText(100, 100, 2)).toBe("0.00 (0.00%)");
  });

  it("counts the percentage from the size of a negative price", () => {
    expect(pct(-10, -5)).toBe(50);
    expect(pct(0, 5)).toBe(0);
  });
});

describe("volume between two bars", () => {
  const volumes = [10, 20, 30, 40, 50];

  it("adds both ends in, in either direction", () => {
    expect(volumeBetween(volumes, 1, 3)).toBe(90);
    expect(volumeBetween(volumes, 3, 1)).toBe(90);
    expect(volumeBetween(volumes, 2, 2)).toBe(30);
  });

  it("stops at the ends of the data", () => {
    expect(volumeBetween(volumes, -3, 1)).toBe(30);
    expect(volumeBetween(volumes, 3, 9)).toBe(90);
    expect(volumeBetween(volumes, 7, 9)).toBeNull();
  });

  it("has none for a symbol without volume, and skips the bars that lack one", () => {
    expect(volumeBetween([null, undefined, null], 0, 2)).toBeNull();
    // today's bar built from a quote may have no volume yet
    expect(volumeBetween([10, 20, null], 0, 2)).toBe(30);
  });
});

describe("the ruler's box", () => {
  it("shows the change, the bars with the days, and the volume", () => {
    expect(measureLines({ from: 100, to: 110, bars: 12, days: 16, volume: 1_234_567 }, 2)).toEqual(["+10.00 (+10.00%)", "12 根K线，16d", "成交量 1.23M"]);
    expect(measureLines({ from: 110, to: 100, bars: -12, days: -16, volume: 987 }, 2)).toEqual(["-10.00 (-9.09%)", "-12 根K线，-16d", "成交量 987"]);
    expect(measureLines({ from: 1, to: 2, bars: 3, days: 3, volume: 4.5e9 }, 2)[2]).toBe("成交量 4.50B");
    expect(measureLines({ from: 1, to: 2, bars: 3, days: 3, volume: 45_600 }, 2)[2]).toBe("成交量 45.60K");
  });

  it("leaves the volume out when the symbol has none", () => {
    expect(measureLines({ from: 100, to: 110, bars: 1, days: 1, volume: null }, 2)).toEqual(["+10.00 (+10.00%)", "1 根K线，1d"]);
  });
});
