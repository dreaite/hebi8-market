/**
 * Editing finished drawings the TradingView way: the extra handles of boxes and parallel channels.
 * Type-only imports, so it loads without KLineChart.
 */
import type { Coordinate, Point } from "klinecharts";

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
