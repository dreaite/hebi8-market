import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Overlay } from "klinecharts";
import { drawingOf, specOf } from "@/components/drawing-spec";
import type { OverlaySpec } from "@/lib/vault";

// KLineChart's own overlay objects: they keep the point objects they are given and merge styles in place
type Live = Overlay & { override: (o: object) => void; eventPressedPointMove: (point: object, index: number) => void };
let make: () => Live;
beforeAll(async () => {
  vi.stubGlobal("window", globalThis);
  const { getOverlayClass } = await import("klinecharts");
  const Segment = getOverlayClass("segment")!;
  make = () => {
    const o = new Segment() as unknown as Live;
    o.override({ id: "drawing_1" });
    return o;
  };
});

const saved = (): OverlaySpec => ({
  name: "segment",
  points: [
    { timestamp: 1, value: 20 },
    { timestamp: 2, value: 30 },
  ],
  styles: { line: { color: "#ff0000" } },
  extendData: { note: "a" },
});

describe("saved drawings and the chart share no objects", () => {
  it("a point dragged after undo does not change the saved state it was drawn from", () => {
    const spec = saved();
    const shared = make();
    // what undo did before: the saved points went to KLineChart as they were
    shared.override({ points: spec.points });
    shared.eventPressedPointMove({ timestamp: 1, value: 40 }, 0);
    expect(spec.points[0].value).toBe(40);

    const fresh = saved();
    const o = make();
    o.override(drawingOf(fresh));
    o.eventPressedPointMove({ timestamp: 1, value: 40 }, 0);
    expect(fresh.points[0].value).toBe(20);
    expect(o.points[0].value).toBe(40);
  });

  it("a later style or text change does not reach a saved state", () => {
    const o = make();
    o.override(drawingOf(saved()));
    const red = specOf(o, new Map())!;
    o.override({ styles: { line: { color: "#0000ff" } }, extendData: { note: "b" } });
    expect(o.styles?.line?.color).toBe("#0000ff");
    expect(red.styles).toEqual({ line: { color: "#ff0000" } });
    expect(red.extendData).toEqual({ note: "a" });
    expect(specOf(o, new Map())!.styles).toEqual({ line: { color: "#0000ff" } });
  });
});
