import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Chart, Overlay } from "klinecharts";
import type { PriceScale } from "@/components/drawing-scale";
import { drawingOf, specOf, type DrawingFlags } from "@/components/drawing-spec";

const DAY = 86400000;
const bars = [100, 200, 300].map((close, i) => ({ timestamp: (i + 1) * DAY, open: close, high: close, low: close, close }));
/** The little of a chart the regression reads: its bars, KLineChart's store, the main axis. */
const chart = {
  getDataList: () => bars,
  getChartStore: () => ({
    timestampToDataIndex: (t: number) => bars.findIndex((b) => b.timestamp === t),
    dataIndexToTimestamp: (i: number) => bars[i]?.timestamp ?? null,
  }),
  getYAxes: () => [{ name: "normal" }],
} as unknown as Chart;

type Live = Overlay & { override: (o: object) => void };
const scales = new Map<string, PriceScale>();
let make: (id: string) => Live;
beforeAll(async () => {
  vi.stubGlobal("window", globalThis);
  const { getOverlayClass } = await import("klinecharts");
  const { registerDrawingTemplates, setOverlayChart } = await import("@/components/chart-overlays");
  registerDrawingTemplates();
  setOverlayChart(chart, (id) => scales.get(id));
  const Regression = getOverlayClass("regressionTrend")!;
  make = (id) => {
    const o = new Regression() as unknown as Live;
    o.override({ id });
    return o;
  };
});

const values = (o: Overlay) => o.points.map((p) => Number(p.value!.toFixed(2)));

describe("a regression trend whose price scale is changed", () => {
  it("snaps its points onto the fit in the new scale, as a rebuild (undo / redo, reload) does", () => {
    scales.set("drawing_1", "linear");
    const o = make("drawing_1");
    o.override({ points: [{ timestamp: DAY, value: 0 }, { timestamp: 3 * DAY, value: 0 }] });
    expect(values(o)).toEqual([100, 300]);

    // 价格坐标 → 对数: styles alone (as before) leave the points on the linear fit
    scales.set("drawing_1", "log");
    o.override({ styles: { line: { color: "#ff0000" } } });
    expect(values(o)).toEqual([100, 300]);
    // given its points, KLineChart snaps them onto the log fit
    o.override({ points: o.points.map((p) => ({ ...p })) });
    expect(values(o)).toEqual([104.91, 314.73]);

    // the state saved after the change, put back on the chart (undo then redo, or a reload), lands on the same points
    const flags = new Map<string, DrawingFlags>([["drawing_1", { scale: "log" }]]);
    const spec = specOf(o, flags)!;
    scales.set("drawing_2", "log");
    const rebuilt = make("drawing_2");
    rebuilt.override(drawingOf(spec));
    expect(values(rebuilt)).toEqual([104.91, 314.73]);
  });
});
