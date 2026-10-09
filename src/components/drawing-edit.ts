/**
 * Editing finished drawings the TradingView way: the extra handles of boxes and parallel channels,
 * a trend line's extension, and undo / redo. Type-only imports, so it loads without KLineChart.
 */
import type { Coordinate, Point } from "klinecharts";
import { movePrices, type PriceScale } from "./drawing-scale";

type P = Partial<Point>;
type C = Coordinate;

// ---------------------------------------------------------------------------- boxes

/**
 * A handle of a two-point box besides its two stored corners: x from point `xi`, y from point
 * `yi`, the middle of the box where one is null (an edge's midpoint, which moves one side only).
 */
export interface BoxHandle {
  key: string;
  xi: 0 | 1 | null;
  yi: 0 | 1 | null;
}

export const BOX_HANDLES: BoxHandle[] = [
  { key: "handle:x0y1", xi: 0, yi: 1 },
  { key: "handle:x1y0", xi: 1, yi: 0 },
  { key: "handle:x0", xi: 0, yi: null },
  { key: "handle:x1", xi: 1, yi: null },
  { key: "handle:y0", xi: null, yi: 0 },
  { key: "handle:y1", xi: null, yi: 1 },
];

/** Where a box handle sits, from the box's two corners in px. */
export function boxHandleAt([a, b]: C[], h: BoxHandle): C {
  const pick = (i: 0 | 1 | null, k: "x" | "y") => (i === null ? (a[k] + b[k]) / 2 : [a, b][i][k]);
  return { x: pick(h.xi, "x"), y: pick(h.yi, "y") };
}

/**
 * The box after dragging a handle: KLineChart moved the whole drawing (`moved` is `prev` shifted by
 * the pointer's travel); only the side the handle stands for keeps that move.
 */
export function dragBox(prev: P[], moved: P[], h: BoxHandle): P[] {
  const next = prev.map((p) => ({ ...p }));
  if (h.xi !== null) Object.assign(next[h.xi], { timestamp: moved[h.xi].timestamp, dataIndex: moved[h.xi].dataIndex });
  if (h.yi !== null) next[h.yi].value = moved[h.yi].value;
  return next;
}

/**
 * The box after dragging a handle by the pointer from price `from` to `to`: the handle's side moves
 * in the drawing's scale (by the ratio in a log one) and to the time in `moved`, where KLineChart's
 * whole-drawing move put it. Worked out from the pointer, not from that move, which may have been
 * refused for a side the handle leaves alone.
 */
export function dragBoxBy(prev: P[], moved: P[], h: BoxHandle, from: number, to: number, scale: PriceScale): P[] {
  const value = h.yi === null ? undefined : movePrices([prev[h.yi].value], from, to, scale, false)?.[0];
  return dragBox(prev, moved.map((p, i) => (i === h.yi ? { ...p, value } : p)), h);
}

/** Every price can be drawn: a number, and above zero where the drawing or the axis is logarithmic (`positive`). */
export const drawable = (points: P[], positive: boolean): boolean => points.every((p) => p.value === undefined || (Number.isFinite(p.value) && (!positive || p.value > 0)));

// ---------------------------------------------------------------------------- parallel channel

/**
 * The parallel channel's handles: the three stored points (the first line's ends and the start of
 * the second), the second line's end, both lines' midpoints (they set the width) and, for a channel
 * saved before the third point was pinned to the second line's start, that start too.
 */
export type ChannelHandle = "p0" | "p1" | "p2" | "a2" | "b2" | "mid1" | "mid2";

/** y on the line through a and b at x (a's y when the line is vertical). */
export function yAt(a: C, b: C, x: number): number {
  return a.x === b.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

/** How far (px, downwards) the second line lies from the first; the third point is anywhere on it. */
export const channelOffset = ([a, b, c]: C[]): number => c.y - yAt(a, b, c.x);

/** Where the channel's handles sit, in px. */
export function channelHandles(cs: C[]): Record<Exclude<ChannelHandle, "p0" | "p1" | "p2">, C> {
  const [a, b] = cs;
  const d = channelOffset(cs);
  const a2 = { x: a.x, y: a.y + d };
  const b2 = { x: b.x, y: b.y + d };
  return { a2, b2, mid1: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, mid2: { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 } };
}

/**
 * The channel after dragging a handle to `to` (px), as TradingView does it: an end moves its line
 * and the other line's matching end with it, so the width stays; a midpoint moves its line alone,
 * which sets the width. The third point comes back at the start of the second line.
 */
export function dragChannel(cs: C[], handle: ChannelHandle, to: C): C[] {
  const [a, b, c] = cs;
  const d = channelOffset(cs);
  const start2 = { x: a.x, y: a.y + d };
  const below = (p: C, dy: number) => ({ x: p.x, y: p.y + dy });
  switch (handle) {
    case "p0":
      return [to, b, below(to, d)];
    case "p1":
      return [a, to, start2];
    case "p2":
      // an old channel's third point sits anywhere on the second line: it moves that line
      if (c.x !== a.x) return [a, b, below(a, to.y - yAt(a, b, to.x))];
      return [below(to, -d), b, to];
    case "a2":
      return [below(to, -d), b, to];
    case "b2":
      return [a, below(to, -d), start2];
    case "mid1": {
      const dy = to.y - (a.y + b.y) / 2;
      return [below(a, dy), below(b, dy), start2];
    }
    case "mid2":
      return [a, b, below(start2, to.y - (a.y + b.y) / 2 - d)];
  }
}

// ---------------------------------------------------------------------------- trend lines

/** TradingView's trend line with 向左延长 / 向右延长 is one of these three, as the TradingView import maps it. */
export const TREND_LINES = new Set(["segment", "rayLine", "straightLine"]);

export interface Extension {
  left: boolean;
  right: boolean;
}

/** Which ways a trend line runs on past its points (left and right as on the chart). */
export function extensionOf(name: string, points: P[]): Extension {
  if (name === "straightLine") return { left: true, right: true };
  if (name !== "rayLine") return { left: false, right: false };
  // a ray runs on past its second point
  const leftward = (points[0]?.timestamp ?? 0) > (points[1]?.timestamp ?? 0);
  return { left: leftward, right: !leftward };
}

/** The tool and point order that draw a trend line extended this way: a leftward ray starts at its later point. */
export function withExtension<T extends P>(points: T[], ext: Extension): { name: string; points: T[] } {
  if (ext.left === ext.right) return { name: ext.left ? "straightLine" : "segment", points };
  const [early, late] = (points[0].timestamp ?? 0) <= (points[1].timestamp ?? 0) ? [points[0], points[1]] : [points[1], points[0]];
  return { name: "rayLine", points: ext.right ? [early, late] : [late, early] };
}

// ---------------------------------------------------------------------------- settings dialog

/**
 * The settings dialog's point fields as sent back: the parsed field of each point whose text was
 * changed, undefined for the rest (they keep their exact value), or undefined when none was.
 */
export function editedFields<T>(shown: string[], typed: string[], parse: (text: string) => T): (T | undefined)[] | undefined {
  const fields = typed.map((text, i) => (text && text !== shown[i] ? parse(text) : undefined));
  return fields.some((f) => f !== undefined) ? fields : undefined;
}

// ---------------------------------------------------------------------------- undo / redo

/** Saved states of the drawings, oldest first; `present` is what the chart shows. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

const DEPTH = 100;

export const historyOf = <T>(present: T): History<T> => ({ past: [], present, future: [] });

/** A change was made: the old state can be undone, and what was undone is gone. Same state, same history. */
export function record<T>(h: History<T>, next: T): History<T> {
  if (JSON.stringify(next) === JSON.stringify(h.present)) return h;
  return { past: [...h.past, h.present].slice(-DEPTH), present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> | null {
  if (h.past.length === 0) return null;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> | null {
  if (h.future.length === 0) return null;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
