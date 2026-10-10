import { describe, expect, it } from "vitest";
import { FIB_DEFAULTS, FIB_LEVELS, fibBands, fibPrice, fibSettingsOf, fibSpan } from "@/components/fib";

describe("fibonacci levels", () => {
  it("has TradingView's default levels in order, past 1 too", () => {
    expect(FIB_LEVELS.map((l) => l.level)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]);
    for (const l of FIB_LEVELS) expect(l.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("extends a retracement past its first point", () => {
    // drawn from a high of 200 down to a low of 100: 0 at the low, 1 at the high, 1.618 above it
    const price = (level: number) => fibPrice("linear", [200, 100], level, false);
    expect(price(0)).toBe(100);
    expect(price(1)).toBe(200);
    expect(price(0.618)).toBeCloseTo(161.8);
    expect(price(1.618)).toBeCloseTo(261.8);
    // on a log drawing the extension is a ratio
    expect(fibPrice("log", [200, 100], 2.618, false)).toBeCloseTo(100 * 2 ** 2.618);
  });

  it("runs a reversed retracement past its second point, the points where they were", () => {
    // drawn from a low of 100 up to a high of 200: as drawn the extension goes down, reversed it goes up
    expect(fibPrice("linear", [100, 200], 1.618, false)).toBeCloseTo(38.2);
    const price = (level: number) => fibPrice("linear", [100, 200], level, true);
    expect(price(0)).toBe(100);
    expect(price(1)).toBe(200);
    expect(price(0.618)).toBeCloseTo(161.8);
    expect(price(1.618)).toBeCloseTo(261.8);
    expect(fibPrice("log", [100, 200], 2.618, true)).toBeCloseTo(100 * 2 ** 2.618);
  });

  it("counts an extension's move from the third point, and the other way when reversed", () => {
    // A 100 → B 200, pulled back to C 150
    expect(fibPrice("linear", [100, 200, 150], 0, false)).toBe(150);
    expect(fibPrice("linear", [100, 200, 150], 1, false)).toBe(250);
    expect(fibPrice("linear", [100, 200, 150], 1.618, false)).toBeCloseTo(311.8);
    expect(fibPrice("linear", [100, 200, 150], 0, true)).toBe(150);
    expect(fibPrice("linear", [100, 200, 150], 1, true)).toBe(50);
    // in a log drawing the move is a ratio: doubled from C, halved when reversed
    expect(fibPrice("log", [100, 200, 150], 1, false)).toBeCloseTo(300);
    expect(fibPrice("log", [100, 200, 150], 1, true)).toBeCloseTo(75);
    expect(fibPrice("log", [100, 200, 150], 4.236, true)).toBeGreaterThan(0);
  });
});

describe("fibonacci settings", () => {
  it("gives a drawing saved without any the defaults", () => {
    expect(fibSettingsOf(undefined)).toEqual({ background: true, transparency: 80, extendLeft: false, extendRight: false, oneColor: false, reverse: false });
    // ...and so has one saved before a setting was added
    expect(fibSettingsOf({ background: false, transparency: 60, extendLeft: false, extendRight: true, oneColor: false })).toMatchObject({ background: false, extendRight: true, reverse: false });
    expect(fibSettingsOf(undefined)).not.toBe(FIB_DEFAULTS);
  });

  it("reads what the drawing keeps", () => {
    expect(fibSettingsOf({ ...FIB_DEFAULTS, background: false, extendRight: true })).toMatchObject({ background: false, transparency: 80, extendRight: true });
  });
});

describe("fibonacci geometry", () => {
  it("runs the level lines between the two points, whichever came first", () => {
    expect(fibSpan(300, 120, FIB_DEFAULTS, 800)).toEqual([120, 300]);
    expect(fibSpan(120, 300, FIB_DEFAULTS, 800)).toEqual([120, 300]);
  });

  it("extends them to the pane's edge on the side asked for", () => {
    expect(fibSpan(120, 300, { extendLeft: true, extendRight: false }, 800)).toEqual([0, 300]);
    expect(fibSpan(120, 300, { extendLeft: false, extendRight: true }, 800)).toEqual([120, 800]);
    expect(fibSpan(120, 300, { extendLeft: true, extendRight: true }, 800)).toEqual([0, 800]);
    // points scrolled off the pane still bound the lines
    expect(fibSpan(-50, 900, { extendLeft: true, extendRight: true }, 800)).toEqual([-50, 900]);
  });

  it("fills between neighbouring levels in the colour of the further one", () => {
    const levels = [
      { y: 400, color: "grey" },
      { y: 350, color: "red" },
      { y: 320, color: "orange" },
    ];
    expect(fibBands(levels)).toEqual([
      { y: 350, height: 50, color: "red" },
      { y: 320, height: 30, color: "orange" },
    ]);
    // the same bands when the levels run down the pane
    expect(fibBands(levels.map((l) => ({ ...l, y: 800 - l.y })))).toEqual([
      { y: 400, height: 50, color: "red" },
      { y: 450, height: 30, color: "orange" },
    ]);
    expect(fibBands(FIB_LEVELS.map((l, i) => ({ ...l, y: i }))).length).toBe(FIB_LEVELS.length - 1);
  });
});
