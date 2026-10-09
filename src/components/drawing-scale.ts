/**
 * The price scale a drawing is straight in (design §1.3 `overlays[].scale`): a line drawn on a log
 * axis is straight in log prices, so on a linear axis it is a curve, and the other way round. Pure
 * math, tested without a chart: prices to and from a scale's space, levels, moving a whole drawing,
 * the regression of the closes, and bending figures drawn in one scale onto an axis of the other.
 * Type-only imports, so it loads without KLineChart (which needs a window).
 */
import type { Coordinate } from "klinecharts";

export type PriceScale = "log" | "linear";

type C = Coordinate;

export const toSpace = (scale: PriceScale, price: number) => (scale === "log" ? Math.log10(price) : price);
export const fromSpace = (scale: PriceScale, u: number) => (scale === "log" ? 10 ** u : u);

/**
 * `level` of the move from `from` to `to`, counted from `base` (by default `from`): a Fibonacci
 * level, or an extension from a third point. A share of the difference in a linear space, of the
 * ratio in a log one, so 0.5 of a log drawing sits halfway on a log axis.
 */
export function levelPrice(scale: PriceScale, from: number, to: number, level: number, base = from): number {
  return fromSpace(scale, toSpace(scale, base) + (toSpace(scale, to) - toSpace(scale, from)) * level);
}

/**
 * The prices of a whole drawing dragged by the pointer from price `from` to `to`: shifted by the
 * difference in a linear space, scaled by the ratio in a log one, so its shape holds. Null when a
 * price would land at zero or below where that cannot be drawn (`positive`: the drawing or the axis
 * is logarithmic); the drawing then stays where it was.
 */
export function movePrices(values: (number | undefined)[], from: number, to: number, scale: PriceScale, positive: boolean): (number | undefined)[] | null {
  const moved = values.map((v) => (v === undefined ? v : scale === "log" ? v * (to / from) : v + (to - from)));
  return moved.every((v) => v === undefined || (Number.isFinite(v) && (!positive || v > 0))) ? moved : null;
}

/**
 * Least squares line through `values` against their index (0, 1, …) in the scale's space, and the
 * standard deviation of the residuals there: `price(i, k)` is the fit at index i plus k deviations.
 * Null for fewer than two values.
 */
export function fitLine(values: number[], scale: PriceScale): { price: (i: number, k?: number) => number; sd: number } | null {
  const n = values.length;
  if (n < 2) return null;
  const ys = values.map((v) => toSpace(scale, v));
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, i) => {
    sx += i;
    sy += y;
    sxy += i * y;
    sxx += i * i;
  });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  const sd = Math.sqrt(ys.reduce((ss, y, i) => ss + (y - intercept - slope * i) ** 2, 0) / n);
  return { price: (i, k = 0) => fromSpace(scale, intercept + slope * i + k * sd), sd };
}

// ---------------------------------------------------------------------------- bending onto another axis

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The price axis a drawing is shown on. */
export interface AxisMap {
  scale: PriceScale;
  toPixel: (price: number) => number;
  fromPixel: (y: number) => number;
  width: number;
  height: number;
}

/**
 * A drawing of one scale shown on an axis of the other. Its figures are built in a pixel space of
 * its own, where y is linear in its scale's space (`toY` / `fromY`) and which matches the axis
 * around the drawing's prices; `point` carries a point of that space onto the axis (same x), null
 * where its price cannot be shown there. `box` is what the pane shows, in the drawing's space.
 */
export interface Warp {
  toY: (price: number) => number;
  fromY: (y: number) => number;
  point: (c: C) => C | null;
  box: Box;
}

/** Past the pane's edges, so clipped figures still run off it. */
const MARGIN = 50;

/** Null when the drawing cannot be placed in its scale (no prices, or none the scale takes). */
export function makeWarp(scale: PriceScale, axis: AxisMap, prices: number[]): Warp | null {
  const us = prices.map((v) => toSpace(scale, v));
  const u0 = us.reduce((a, b) => a + b, 0) / us.length;
  const y0 = axis.toPixel(fromSpace(scale, u0));
  // pixels per unit of the scale's space just above the drawing's mean price, so the two spaces
  // agree around it (over 50px: KLineChart rounds its pixels)
  const g = -50 / (toSpace(scale, axis.fromPixel(y0 - 50)) - toSpace(scale, axis.fromPixel(y0)));
  if (!Number.isFinite(g) || g === 0) return null;
  const toY = (price: number) => y0 + g * (toSpace(scale, price) - u0);
  const fromY = (y: number) => fromSpace(scale, u0 + (y - y0) / g);
  const point = (c: C): C | null => {
    const price = fromY(c.y);
    return Number.isFinite(price) && (axis.scale !== "log" || price > 0) ? { x: c.x, y: axis.toPixel(price) } : null;
  };
  // the prices the pane shows; a log drawing on a linear axis that reaches zero stops just above it
  const ends = [axis.fromPixel(-MARGIN), axis.fromPixel(axis.height + MARGIN)];
  const hi = Math.max(...ends);
  if (scale === "log" && hi <= 0) return null;
  const lo = scale === "log" ? Math.max(Math.min(...ends), hi * 1e-6) : Math.min(...ends);
  const [ya, yb] = [toY(lo), toY(hi)];
  return { toY, fromY, point, box: { left: -MARGIN, right: axis.width + MARGIN, top: Math.min(ya, yb), bottom: Math.max(ya, yb) } };
}

/** The part of the segment a→b inside the box (Liang–Barsky), null when none is. */
export function clipSegment(a: C, b: C, box: Box): [C, C] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** A polygon cut to the box (Sutherland–Hodgman). */
export function clipPolygon(cs: C[], box: Box): C[] {
  const edges: [(c: C) => boolean, (a: C, b: C) => C][] = [
    [(c) => c.x >= box.left, (a, b) => atX(a, b, box.left)],
    [(c) => c.x <= box.right, (a, b) => atX(a, b, box.right)],
    [(c) => c.y >= box.top, (a, b) => atY(a, b, box.top)],
    [(c) => c.y <= box.bottom, (a, b) => atY(a, b, box.bottom)],
  ];
  return edges.reduce((poly, [inside, cut]) => {
    return poly.flatMap((c, i) => {
      const prev = poly[(i + poly.length - 1) % poly.length];
      if (inside(c)) return inside(prev) ? [c] : [cut(prev, c), c];
      return inside(prev) ? [cut(prev, c)] : [];
    });
  }, cs);
}

const atX = (a: C, b: C, x: number): C => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
const atY = (a: C, b: C, y: number): C => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });

/**
 * The segment a→b of the drawing's space as points on the axis, halved until every piece is within
 * half a pixel of the curve or a couple of pixels long. Both ends must map (`clipSegment` to the
 * warp's box first).
 */
export function bend(a: C, b: C, point: (c: C) => C | null): C[] {
  const out = [point(a)!];
  const split = (a: C, b: C, pa: C, pb: C, depth: number) => {
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const pm = point(m)!;
    const off = Math.hypot(pm.x - (pa.x + pb.x) / 2, pm.y - (pa.y + pb.y) / 2);
    if (depth < 10 && off > 0.5 && Math.hypot(pb.x - pa.x, pb.y - pa.y) > 2) {
      split(a, m, pa, pm, depth + 1);
      split(m, b, pm, pb, depth + 1);
    } else out.push(pb);
  };
  split(a, b, out[0], point(b)!, 0);
  return out;
}

/** A polyline of the drawing's space on the axis: the pieces of it inside the pane, each bent. */
export function bendLine(cs: C[], warp: Warp): C[][] {
  const pieces: C[][] = [];
  let joined = false;
  for (let i = 1; i < cs.length; i++) {
    const clip = clipSegment(cs[i - 1], cs[i], warp.box);
    if (!clip) {
      joined = false;
      continue;
    }
    const pts = bend(clip[0], clip[1], warp.point);
    // a segment that starts where the last one ended continues its piece
    if (joined && clip[0].x === cs[i - 1].x && clip[0].y === cs[i - 1].y) pieces[pieces.length - 1].push(...pts.slice(1));
    else pieces.push(pts);
    joined = clip[1].x === cs[i].x && clip[1].y === cs[i].y;
  }
  return pieces;
}

/** A polygon of the drawing's space on the axis: cut to the pane, every edge bent. */
export function bendPolygon(cs: C[], warp: Warp): C[] {
  const poly = clipPolygon(cs, warp.box);
  return poly.flatMap((c, i) => bend(c, poly[(i + 1) % poly.length], warp.point).slice(0, -1));
}
