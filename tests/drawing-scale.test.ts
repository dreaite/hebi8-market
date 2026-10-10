import { describe, expect, it } from "vitest";
import { bend, bendLine, bendPolygon, bendRect, clipPolygon, clipSegment, fitLine, levelPrice, makeWarp, movePrices, type AxisMap, type PriceScale } from "@/components/drawing-scale";

/** A pane 600px high showing prices lo…hi on a linear or log axis, like KLineChart's. */
function axisOf(scale: PriceScale, lo: number, hi: number, round = false): AxisMap {
  const f = (v: number) => (scale === "log" ? Math.log10(v) : v);
  const g = (u: number) => (scale === "log" ? 10 ** u : u);
  const height = 600;
  return {
    scale,
    width: 800,
    height,
    toPixel: (v) => {
      const y = height - ((f(v) - f(lo)) / (f(hi) - f(lo))) * height;
      return round ? Math.round(y) : y;
    },
    fromPixel: (y) => g(f(lo) + ((height - y) / height) * (f(hi) - f(lo))),
  };
}

describe("levels", () => {
  it("takes a share of the difference in a linear scale, of the ratio in a log one", () => {
    expect(levelPrice("linear", 10, 1000, 0.5)).toBe(505);
    expect(levelPrice("log", 10, 1000, 0.5)).toBeCloseTo(100);
    expect(levelPrice("log", 10, 1000, 0)).toBeCloseTo(10);
    expect(levelPrice("log", 10, 1000, 1)).toBeCloseTo(1000);
  });

  it("extends a move from a third point", () => {
    // A 100 → B 200, from C 150: 1.0 doubles C in log, adds 100 in linear
    expect(levelPrice("linear", 100, 200, 1, 150)).toBe(250);
    expect(levelPrice("log", 100, 200, 1, 150)).toBeCloseTo(300);
    expect(levelPrice("log", 100, 200, 1.618, 150)).toBeCloseTo(150 * 2 ** 1.618);
  });
});

describe("moving a whole drawing", () => {
  it("shifts a linear drawing by the difference and scales a log one by the ratio", () => {
    expect(movePrices([10, 20], 15, 30, "linear", false)).toEqual([25, 35]);
    expect(movePrices([10, 20], 15, 30, "log", true)).toEqual([20, 40]);
  });

  it("keeps a point without a price as it is", () => {
    expect(movePrices([10, undefined], 10, 5, "log", true)).toEqual([5, undefined]);
  });

  it("refuses a move to zero or below where it cannot be drawn", () => {
    // a line from 10 to 100 grabbed at 100 and pulled down to 50
    expect(movePrices([10, 100], 100, 50, "linear", true)).toBeNull();
    expect(movePrices([10, 100], 100, 50, "linear", false)).toEqual([-40, 50]);
    // a log drawing dragged on a linear axis to a pointer at or below zero
    expect(movePrices([10, 100], 100, -5, "log", true)).toBeNull();
    expect(movePrices([10, 100], 100, 0, "log", true)).toBeNull();
    // ...and anywhere above it keeps its ratio
    expect(movePrices([10, 100], 100, 1, "log", true)).toEqual([0.1, 1]);
  });
});

describe("regression", () => {
  it("fits log closes for a log drawing, so a steady growth has no deviation", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 * 1.05 ** i);
    const fit = fitLine(closes, "log")!;
    expect(fit.sd).toBeCloseTo(0, 10);
    expect(fit.price(10)).toBeCloseTo(closes[10]);
    expect(fit.price(25)).toBeCloseTo(100 * 1.05 ** 25);
    // the same series fitted on prices misses the curve
    expect(fitLine(closes, "linear")!.sd).toBeGreaterThan(1);
  });

  it("puts the deviation bands in the fit's space: a ratio for a log fit", () => {
    const closes = [100, 200, 100, 200];
    const log = fitLine(closes, "log")!;
    expect(log.price(1, 1) / log.price(1)).toBeCloseTo(log.price(2) / log.price(2, -1));
    const lin = fitLine(closes, "linear")!;
    expect(lin.price(0, 2) - lin.price(0)).toBeCloseTo(lin.price(0) - lin.price(0, -2));
  });

  it("needs two closes", () => {
    expect(fitLine([1], "linear")).toBeNull();
  });
});

describe("clipping", () => {
  const box = { left: 0, right: 100, top: 0, bottom: 100 };

  it("keeps the part of a segment inside the box", () => {
    expect(clipSegment({ x: -50, y: 50 }, { x: 150, y: 50 }, box)).toEqual([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ]);
    expect(clipSegment({ x: 10, y: 10 }, { x: 20, y: 20 }, box)).toEqual([
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    expect(clipSegment({ x: -10, y: -10 }, { x: -5, y: 200 }, box)).toBeNull();
  });

  it("cuts a polygon to the box", () => {
    const cut = clipPolygon(
      [
        { x: -50, y: 20 },
        { x: 150, y: 20 },
        { x: 150, y: 80 },
        { x: -50, y: 80 },
      ],
      box,
    );
    expect(cut).toHaveLength(4);
    expect(Math.min(...cut.map((c) => c.x))).toBe(0);
    expect(Math.max(...cut.map((c) => c.x))).toBe(100);
  });
});

describe("a drawing on an axis of the other scale", () => {
  it("draws a log line on a linear axis through the geometric mean between its points", () => {
    const axis = axisOf("linear", 0, 1100);
    const warp = makeWarp("log", axis, [10, 1000])!;
    const a = { x: 100, y: warp.toY(10) };
    const b = { x: 500, y: warp.toY(1000) };
    // the ends are where the axis has their prices
    expect(warp.point(a)!.y).toBeCloseTo(axis.toPixel(10));
    expect(warp.point(b)!.y).toBeCloseTo(axis.toPixel(1000));
    const [curve] = bendLine([a, b], warp);
    expect(curve.length).toBeGreaterThan(8);
    // halfway in time it is at 100, not at the linear 505
    const half = curve.reduce((best, c) => (Math.abs(c.x - 300) < Math.abs(best.x - 300) ? c : best));
    expect(axis.fromPixel(half.y)).toBeCloseTo(100 * 10 ** ((2 * (half.x - 300)) / 400), 0);
    // every piece stays within half a pixel or so of the true curve
    for (let i = 1; i < curve.length; i++) {
      const m = { x: (curve[i - 1].x + curve[i].x) / 2, y: (curve[i - 1].y + curve[i].y) / 2 };
      const t = (m.x - 100) / 400;
      expect(Math.abs(axis.toPixel(10 * 100 ** t) - m.y)).toBeLessThan(0.75);
    }
  });

  it("works on an axis that rounds to whole pixels, as KLineChart's does", () => {
    const axis = axisOf("linear", -50, 250, true);
    const warp = makeWarp("log", axis, [3.4, 14.3])!;
    expect(warp).not.toBeNull();
    const [curve] = bendLine(
      [
        { x: 0, y: warp.toY(3.4) },
        { x: 400, y: warp.toY(14.3) },
      ],
      warp,
    );
    expect(curve.length).toBeGreaterThan(2);
    const half = curve.find((c) => c.x >= 200)!;
    expect(axis.fromPixel(half.y)).toBeCloseTo(3.4 * (14.3 / 3.4) ** (half.x / 400), 0);
  });

  it("draws a linear line on a log axis through the arithmetic mean", () => {
    const axis = axisOf("log", 5, 2000);
    const warp = makeWarp("linear", axis, [10, 1000])!;
    const [curve] = bendLine(
      [
        { x: 0, y: warp.toY(10) },
        { x: 400, y: warp.toY(1000) },
      ],
      warp,
    );
    const half = curve.find((c) => c.x >= 200)!;
    expect(axis.fromPixel(half.y)).toBeCloseTo(10 + (990 * half.x) / 400, 0);
  });

  it("is a straight line again on an axis of its own scale", () => {
    const axis = axisOf("log", 5, 2000);
    const pts = bend({ x: 0, y: axis.toPixel(10) }, { x: 400, y: axis.toPixel(1000) }, (c) => c);
    expect(pts).toHaveLength(2);
  });

  it("stops a line at the pane, short of the prices the axis cannot show", () => {
    // a linear line falling through zero, shown on a log axis
    const axis = axisOf("log", 5, 2000);
    const warp = makeWarp("linear", axis, [1000, 500])!;
    const far = { x: 4000, y: warp.toY(-4000) };
    const pieces = bendLine([{ x: 0, y: warp.toY(1000) }, far], warp);
    expect(pieces).toHaveLength(1);
    const last = pieces[0].at(-1)!;
    expect(axis.fromPixel(last.y)).toBeGreaterThan(0);
    expect(last.y).toBeLessThanOrEqual(axis.height + 50 + 1e-6);
    // a log line falling towards zero on a linear axis that shows zero ends just above it
    const lin = axisOf("linear", -100, 1000);
    const down = makeWarp("log", lin, [1000, 100])!;
    const [piece] = bendLine([{ x: 0, y: down.toY(1000) }, { x: 800, y: down.toY(1e-9) }], down);
    expect(lin.fromPixel(piece.at(-1)!.y)).toBeGreaterThan(0);
    expect(lin.fromPixel(piece.at(-1)!.y)).toBeLessThan(0.01);
  });

  it("bends a filled band and keeps it closed", () => {
    const axis = axisOf("linear", 0, 1100);
    const warp = makeWarp("log", axis, [10, 1000])!;
    const band = bendPolygon(
      [
        { x: 0, y: warp.toY(10) },
        { x: 400, y: warp.toY(1000) },
        { x: 400, y: warp.toY(500) },
        { x: 0, y: warp.toY(5) },
      ],
      warp,
    );
    expect(band.length).toBeGreaterThan(8);
    expect(band[0].y).toBeCloseTo(axis.toPixel(10));
  });

  it("carries a level band's top and bottom over", () => {
    const axis = axisOf("linear", 0, 1100);
    const warp = makeWarp("log", axis, [10, 1000])!;
    const rect = bendRect({ x: 100, y: warp.toY(1000), width: 300, height: warp.toY(100) - warp.toY(1000) }, warp)!;
    expect(rect).toMatchObject({ x: 100, width: 300 });
    expect(rect.y).toBeCloseTo(axis.toPixel(1000));
    expect(rect.y + rect.height).toBeCloseTo(axis.toPixel(100));
  });

  it("keeps the part of a band above the prices a log axis cannot show", () => {
    // a linear drawing's levels from 50 down to -100 on a log axis showing 10…1000
    const axis = axisOf("log", 10, 1000);
    const warp = makeWarp("linear", axis, [100, 200])!;
    const rect = bendRect({ x: 0, y: warp.toY(50), width: 10, height: warp.toY(-100) - warp.toY(50) }, warp)!;
    expect(rect.y).toBeCloseTo(axis.toPixel(50));
    expect(rect.y + rect.height).toBeGreaterThan(axis.height);
    // ...and nothing of one that is all below them
    expect(bendRect({ x: 0, y: warp.toY(-50), width: 10, height: warp.toY(-100) - warp.toY(-50) }, warp)).toBeNull();
  });
});
