import { describe, expect, it } from "vitest";
import {
  BOX_HANDLES,
  boxHandleAt,
  channelHandles,
  channelOffset,
  dragBox,
  dragChannel,
  extensionOf,
  historyOf,
  record,
  redo,
  undo,
  withExtension,
} from "@/components/drawing-edit";

const DAY = 86400000;
const handle = (key: string) => BOX_HANDLES.find((h) => h.key === `handle:${key}`)!;

describe("box handles", () => {
  const corners = [
    { x: 10, y: 100 },
    { x: 50, y: 20 },
  ];

  it("sits at the other two corners and the middle of each side", () => {
    expect(BOX_HANDLES.map((h) => boxHandleAt(corners, h))).toEqual([
      { x: 10, y: 20 },
      { x: 50, y: 100 },
      { x: 10, y: 60 },
      { x: 50, y: 60 },
      { x: 30, y: 100 },
      { x: 30, y: 20 },
    ]);
  });

  const prev = [
    { timestamp: 1 * DAY, value: 10 },
    { timestamp: 5 * DAY, value: 20 },
  ];
  // KLineChart moved the whole box two bars right and 3 up
  const moved = [
    { timestamp: 3 * DAY, value: 13 },
    { timestamp: 7 * DAY, value: 23 },
  ];

  it("moves one side only from an edge's midpoint", () => {
    expect(dragBox(prev, moved, handle("x1"))).toEqual([prev[0], { timestamp: 7 * DAY, value: 20 }]);
    expect(dragBox(prev, moved, handle("y0"))).toEqual([{ timestamp: 1 * DAY, value: 13 }, prev[1]]);
  });

  it("moves the two sides that meet at a corner", () => {
    // x of the first point, y of the second: the first point's time and the second's price change
    expect(dragBox(prev, moved, handle("x0y1"))).toEqual([
      { timestamp: 3 * DAY, value: 10 },
      { timestamp: 5 * DAY, value: 23 },
    ]);
  });

  it("does not touch the points it was given", () => {
    dragBox(prev, moved, handle("x0y1"));
    expect(prev[0]).toEqual({ timestamp: 1 * DAY, value: 10 });
  });
});

describe("parallel channel", () => {
  // first line from (0, 100) to (100, 50), the second 30px below it, its start pinned at x 0
  const channel = [
    { x: 0, y: 100 },
    { x: 100, y: 50 },
    { x: 0, y: 130 },
  ];
  const width = (cs: { x: number; y: number }[]) => channelOffset(cs);

  it("puts the second line's end and both midpoints as handles", () => {
    expect(channelHandles(channel)).toEqual({ a2: { x: 0, y: 130 }, b2: { x: 100, y: 80 }, mid1: { x: 50, y: 75 }, mid2: { x: 50, y: 105 } });
  });

  it("keeps the width when an end of either line is dragged", () => {
    const fromStart = dragChannel(channel, "p0", { x: 10, y: 60 });
    expect(fromStart).toEqual([{ x: 10, y: 60 }, channel[1], { x: 10, y: 90 }]);
    expect(width(fromStart)).toBe(30);

    expect(dragChannel(channel, "p1", { x: 120, y: 0 })).toEqual([channel[0], { x: 120, y: 0 }, channel[2]]);

    // the second line's start takes the first line's start with it
    expect(dragChannel(channel, "p2", { x: 5, y: 140 })).toEqual([{ x: 5, y: 110 }, channel[1], { x: 5, y: 140 }]);
    // its end likewise takes the first line's end
    const fromEnd2 = dragChannel(channel, "b2", { x: 110, y: 90 });
    expect(fromEnd2).toEqual([channel[0], { x: 110, y: 60 }, channel[2]]);
    expect(width(fromEnd2)).toBe(30);
  });

  it("sets the width from a line's midpoint", () => {
    // the first line moves up 10: 40 between the lines
    const first = dragChannel(channel, "mid1", { x: 70, y: 65 });
    expect(first).toEqual([{ x: 0, y: 90 }, { x: 100, y: 40 }, channel[2]]);
    expect(width(first)).toBe(40);
    // the second line moves down 20
    expect(width(dragChannel(channel, "mid2", { x: 50, y: 125 }))).toBe(50);
  });

  it("pins an old channel's third point to the second line's start on the first drag", () => {
    // saved when the third point stayed where it was clicked: on the second line, at x 50
    const old = [channel[0], channel[1], { x: 50, y: 105 }];
    expect(dragChannel(old, "p1", { x: 100, y: 40 })).toEqual([channel[0], { x: 100, y: 40 }, { x: 0, y: 130 }]);
    expect(dragChannel(old, "a2", { x: 0, y: 140 })).toEqual([{ x: 0, y: 110 }, channel[1], { x: 0, y: 140 }]);
    // its own handle, in the middle of the second line, moves that line
    expect(dragChannel(old, "p2", { x: 60, y: 120 })).toEqual([channel[0], channel[1], { x: 0, y: 150 }]);
  });
});

describe("trend line extension", () => {
  const early = { timestamp: 1 * DAY, value: 10 };
  const late = { timestamp: 9 * DAY, value: 20 };

  it("reads left and right as on the chart", () => {
    expect(extensionOf("segment", [early, late])).toEqual({ left: false, right: false });
    expect(extensionOf("straightLine", [late, early])).toEqual({ left: true, right: true });
    expect(extensionOf("rayLine", [early, late])).toEqual({ left: false, right: true });
    // the TradingView import's left-only trend line: a ray from the later point
    expect(extensionOf("rayLine", [late, early])).toEqual({ left: true, right: false });
  });

  it("picks the tool and point order, and round-trips", () => {
    expect(withExtension([late, early], { left: false, right: false })).toEqual({ name: "segment", points: [late, early] });
    expect(withExtension([late, early], { left: true, right: true })).toEqual({ name: "straightLine", points: [late, early] });
    expect(withExtension([late, early], { left: false, right: true })).toEqual({ name: "rayLine", points: [early, late] });
    expect(withExtension([early, late], { left: true, right: false })).toEqual({ name: "rayLine", points: [late, early] });
    for (const ext of [
      { left: false, right: false },
      { left: true, right: false },
      { left: false, right: true },
      { left: true, right: true },
    ]) {
      const { name, points } = withExtension([early, late], ext);
      expect(extensionOf(name, points)).toEqual(ext);
    }
  });
});

describe("undo history", () => {
  it("undoes and redoes, and a new change drops what was undone", () => {
    let h = historyOf<string[]>([]);
    h = record(h, ["a"]);
    h = record(h, ["a", "b"]);
    h = undo(h)!;
    expect(h.present).toEqual(["a"]);
    h = undo(h)!;
    expect(h.present).toEqual([]);
    expect(undo(h)).toBeNull();
    h = redo(h)!;
    expect(h.present).toEqual(["a"]);
    h = record(h, ["a", "c"]);
    expect(redo(h)).toBeNull();
    expect(undo(h)!.present).toEqual(["a"]);
  });

  it("records nothing when the state is the same (a click that moved nothing)", () => {
    const h = record(historyOf([{ name: "rect" }]), [{ name: "rect" }]);
    expect(h.past).toEqual([]);
  });
});
