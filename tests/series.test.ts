import { describe, expect, it } from "vitest";
import { aggregate, alignCloses, bucketStart, closeAtOrBefore, dedupeBars, type Bar } from "@/lib/series";

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const bar = (iso: string, c: number, extra: Partial<Bar> = {}): Bar => ({
  t: day(iso),
  o: c,
  h: c,
  l: c,
  c,
  v: 1,
  ...extra,
});

describe("bucketStart", () => {
  it("weeks start on Monday, including for Sunday bars", () => {
    expect(bucketStart(day("2026-10-07"), "W")).toBe(day("2026-10-05")); // Wednesday
    expect(bucketStart(day("2026-10-11"), "W")).toBe(day("2026-10-05")); // Sunday
    expect(bucketStart(day("2026-10-05"), "W")).toBe(day("2026-10-05")); // Monday
  });

  it("months start on the 1st", () => {
    expect(bucketStart(day("2026-02-28"), "M")).toBe(day("2026-02-01"));
  });
});

describe("aggregate", () => {
  const daily = [
    bar("2026-09-28", 10, { o: 9, h: 11, l: 8, v: 100 }),
    bar("2026-09-30", 12, { o: 10, h: 13, l: 10, v: 50 }),
    bar("2026-10-04", 11, { o: 12, h: 12, l: 9, v: 25 }), // Sunday, same week
    bar("2026-10-05", 14, { o: 11, h: 15, l: 11, v: 10 }),
  ];

  it("builds weekly OHLCV", () => {
    expect(aggregate(daily, "W")).toEqual([
      { t: day("2026-09-28"), o: 9, h: 13, l: 8, c: 11, v: 175 },
      { t: day("2026-10-05"), o: 11, h: 15, l: 11, c: 14, v: 10 },
    ]);
  });

  it("builds monthly OHLCV", () => {
    expect(aggregate(daily, "M").map((b) => [b.t, b.o, b.c])).toEqual([
      [day("2026-09-01"), 9, 12],
      [day("2026-10-01"), 12, 14],
    ]);
  });

  it("keeps volume null when the source has none", () => {
    const noVolume = daily.map((b) => ({ ...b, v: null }));
    expect(aggregate(noVolume, "W")[0].v).toBeNull();
  });

  it("does not mutate the daily input", () => {
    const copy = structuredClone(daily);
    aggregate(daily, "W");
    expect(daily).toEqual(copy);
  });
});

describe("alignCloses", () => {
  it("forward-fills benchmark closes across days it did not trade", () => {
    const crypto = [bar("2026-10-02", 1), bar("2026-10-03", 1), bar("2026-10-04", 1), bar("2026-10-05", 1)];
    const stocks = [bar("2026-10-02", 100), bar("2026-10-05", 105)];
    expect(alignCloses(crypto, stocks)).toEqual([100, 100, 100, 105]);
  });

  it("is undefined before the benchmark history starts", () => {
    expect(alignCloses([bar("2026-01-01", 1), bar("2026-01-02", 1)], [bar("2026-01-02", 7)])).toEqual([undefined, 7]);
  });
});

describe("closeAtOrBefore / dedupeBars", () => {
  const bars = [bar("2026-01-01", 1), bar("2026-01-05", 5), bar("2026-01-09", 9)];

  it("finds the latest close at or before a time", () => {
    expect(closeAtOrBefore(bars, day("2026-01-07"))).toBe(5);
    expect(closeAtOrBefore(bars, day("2026-01-09"))).toBe(9);
    expect(closeAtOrBefore(bars, day("2025-12-31"))).toBeUndefined();
  });

  it("sorts and keeps the last bar per timestamp", () => {
    const out = dedupeBars([bar("2026-01-05", 5), bar("2026-01-01", 1), bar("2026-01-05", 6)]);
    expect(out.map((b) => b.c)).toEqual([1, 6]);
  });
});
