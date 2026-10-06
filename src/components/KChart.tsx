"use client";

import { useEffect, useRef } from "react";
import {
  dispose,
  init,
  registerIndicator,
  type Chart,
  type Crosshair,
  type DeepPartial,
  type IndicatorTemplate,
  type KLineData,
  type Overlay,
  type OverlayCreate,
  type Styles,
} from "klinecharts";
import { customIndicators } from "@/indicators/custom";
import type { RefSeries } from "@/indicators/formula";
import type { ChartBar } from "@/lib/api-types";
import type { ChartStyle } from "@/lib/config";
import type { Timeframe } from "@/lib/symbols";
import type { CompareEntry, OverlaySpec } from "@/lib/vault";
import { COMPARE_COLORS, type CompareLegendEntry, type IndicatorSpec } from "./chart-types";

interface KChartProps {
  symbolKey: string;
  tf: Timeframe;
  bars: ChartBar[] | null;
  pricePrecision: number;
  log: boolean;
  chartStyle: ChartStyle;
  indicators: IndicatorSpec[];
  /** Formula templates, re-registered on every change so edits swap in */
  templates: IndicatorTemplate<Record<string, number | undefined>>[];
  compare: (CompareEntry & { hidden?: boolean })[];
  refs: Record<string, RefSeries>;
  overlays: OverlaySpec[];
  onOverlaysChange: (overlays: OverlaySpec[]) => void;
  /** Overlay name of the active drawing tool, null when not drawing */
  drawTool: string | null;
  /** A drawing finished or was abandoned, so the toolbar can deselect */
  onDrawDone: () => void;
  clearSeq: number;
  /** Pixels kept free above the highest candle, for the tooltip and legend rows */
  headroom: number;
  onLegend: (entries: CompareLegendEntry[]) => void;
}

const PERIODS = {
  D: { type: "day", span: 1 },
  W: { type: "week", span: 1 },
  M: { type: "month", span: 1 },
  Q: { type: "month", span: 3 },
} as const;

/** How many bars the initial view should fit: ~2 years of days, ~5 years of weeks, all months. */
const INITIAL_BARS: Record<Timeframe, number> = { D: 500, W: 260, M: Infinity, Q: Infinity };

function initialBarSpace(width: number, tf: Timeframe, total: number): number {
  const plotWidth = Math.max(200, width - 80); // minus the y-axis
  return Math.min(12, Math.max(1.5, plotWidth / Math.min(total, INITIAL_BARS[tf])));
}

const CANDLE_PANE = "candle_pane";
/** The main pane keeps at least this share of the chart; sub panes are a fixed height. */
const MAIN_PANE_SHARE = 0.45;
const SUB_PANE_HEIGHT = 100;
const MAX_COMPARE = COMPARE_COLORS.length;
const compareName = (slot: number) => `CMP${slot}`;
const isCompare = (name: string) => name.startsWith("CMP");
/** Aligned closes per compare slot; templates read them by slot so overrides never merge data. */
const compareSeries: ((number | null)[] | undefined)[] = [];

// Same stacks as globals.css; the canvas cannot read Tailwind's theme.
const SANS = 'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const MONO = 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace';

let registered = false;
function registerTemplates() {
  if (registered) return;
  registered = true;
  customIndicators.forEach((template) => registerIndicator(template as Parameters<typeof registerIndicator>[0]));
  for (let slot = 0; slot < MAX_COMPARE; slot++) {
    registerIndicator<{ v?: number }, number>({
      name: compareName(slot),
      shortName: "对比",
      series: "price",
      // [base index, raw flag]: rebased to the main close at `base`, or the raw close in its own pane
      calcParams: [0, 0],
      figures: [{ key: "v", title: "", type: "line" }],
      // the React legend in ChartView shows these lines; an empty tooltip takes no row
      createTooltipDataSource: () => ({ name: "", calcParamsText: "", features: [], legends: [] }),
      calc: (dataList, indicator) => {
        const closes = compareSeries[slot] ?? [];
        const [base, raw] = indicator.calcParams;
        const mainBase = dataList[base]?.close;
        const cmpBase = closes[base];
        return dataList.map((_, i) => {
          const c = closes[i];
          if (c == null) return {};
          if (raw) return { v: c };
          return mainBase && cmpBase ? { v: (mainBase * c) / cmpBase } : {};
        });
      },
    });
  }
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function applyTheme(chart: Chart, style: ChartStyle) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const up = cssVar("--up");
  const down = cssVar("--down");
  const muted = cssVar("--muted");
  const line = cssVar("--line");
  const accent = cssVar("--accent");
  const axis = { axisLine: { color: line }, tickLine: { color: line }, tickText: { color: muted, family: MONO, size: 11 } };
  const tooltipFont = { title: { family: SANS }, legend: { family: SANS } };
  const overrides: DeepPartial<Styles> = {
    grid: { horizontal: { color: cssVar("--chart-grid") }, vertical: { show: false } },
    candle: {
      type: style,
      area: {
        lineColor: accent,
        lineSize: 1.5,
        backgroundColor: [
          { offset: 0, color: withAlpha(accent, 0.01) },
          { offset: 1, color: withAlpha(accent, 0.16) },
        ],
      },
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: muted,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: muted,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: muted,
      },
      priceMark: {
        high: { textFamily: MONO },
        low: { textFamily: MONO },
        last: { upColor: up, downColor: down, noChangeColor: muted, text: { family: MONO } },
      },
      // The page header already names the symbol and timeframe.
      tooltip: { ...tooltipFont, title: { show: false, family: SANS } },
    },
    indicator: {
      bars: [{ upColor: withAlpha(up, 0.55), downColor: withAlpha(down, 0.55), noChangeColor: muted }],
      tooltip: tooltipFont,
      lastValueMark: { text: { family: MONO } },
    },
    crosshair: { horizontal: { text: { family: MONO } }, vertical: { text: { family: MONO } } },
    overlay: { line: { color: accent }, point: { color: accent, borderColor: withAlpha(accent, 0.35) }, text: { family: SANS } },
    xAxis: axis,
    yAxis: axis,
    separator: { color: line },
  };
  chart.setStyles(dark ? "dark" : "light");
  chart.setStyles(overrides);
}

/** Finished drawings on the main pane; `except` is one being removed right now. */
function serializeOverlays(chart: Chart, except?: string): OverlaySpec[] {
  return chart.getOverlays().flatMap((o) => {
    if (o.paneId !== CANDLE_PANE || o.id === except) return [];
    const points = o.points
      .filter((p) => typeof p.timestamp === "number" && typeof p.value === "number")
      .map((p) => ({ timestamp: p.timestamp!, value: p.value! }));
    if (points.length === 0 || points.length < o.totalStep - 1) return []; // still being drawn
    const spec: OverlaySpec = { name: o.name, points };
    if (o.lock) spec.lock = true;
    if (o.extendData !== undefined && o.extendData !== null && typeof o.extendData !== "function") spec.extendData = o.extendData;
    return [spec];
  });
}

export function KChart({
  symbolKey,
  tf,
  bars,
  pricePrecision,
  log,
  chartStyle,
  indicators,
  templates,
  compare,
  refs,
  overlays,
  onOverlaysChange,
  drawTool,
  onDrawDone,
  clearSeq,
  headroom,
  onLegend,
}: KChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<ChartBar[]>([]);
  const styleRef = useRef(chartStyle);
  const compareRef = useRef(compare);
  const basesRef = useRef<number[]>([]);
  const crosshairRef = useRef<number | null>(null);
  const overlaysRef = useRef(overlays);
  const restoringRef = useRef(false);
  const drawingRef = useRef<{ tool: string; id: string; overlay: Overlay | null; extendData?: unknown } | null>(null);
  const onOverlaysChangeRef = useRef(onOverlaysChange);
  const onDrawDoneRef = useRef(onDrawDone);
  const onLegendRef = useRef(onLegend);
  // Latest props for the chart callbacks; declared first so later effects see the new values.
  useEffect(() => {
    onOverlaysChangeRef.current = onOverlaysChange;
    onDrawDoneRef.current = onDrawDone;
    onLegendRef.current = onLegend;
    compareRef.current = compare;
    overlaysRef.current = overlays;
  }, [onOverlaysChange, onDrawDone, onLegend, compare, overlays]);

  const emitLegend = () => {
    const bars = barsRef.current;
    const idx = Math.min(crosshairRef.current ?? bars.length - 1, bars.length - 1);
    onLegendRef.current(
      compareRef.current.map((c, slot) => {
        const closes = compareSeries[slot];
        const value = closes?.[idx] ?? null;
        const base = closes?.[basesRef.current[slot] ?? 0];
        return { key: c.key, value, pct: value != null && base ? value / base - 1 : null };
      }),
    );
  };

  /** Rebase every compare line to the left edge of the visible range (percent lines on the chart, pane lines in the legend). */
  const updateBases = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const { realFrom } = chart.getVisibleRange();
    const bars = barsRef.current;
    compareRef.current.forEach((c, slot) => {
      const closes = compareSeries[slot];
      if (!closes) return;
      let base = Math.max(0, Math.min(realFrom, bars.length - 1));
      while (base < closes.length && closes[base] == null) base++;
      if (basesRef.current[slot] !== base) {
        basesRef.current[slot] = base;
        if (c.mode === "percent") chart.overrideIndicator({ name: compareName(slot), paneId: CANDLE_PANE, calcParams: [base, 0] });
      }
    });
    emitLegend();
  };

  const persistOverlays = (except?: string) => {
    const chart = chartRef.current;
    if (!chart || restoringRef.current) return;
    onOverlaysChangeRef.current(serializeOverlays(chart, except));
  };

  /** Drop the drawing in progress (if any) and start the same tool again. */
  const restartDrawing = () => {
    const chart = chartRef.current;
    const d = drawingRef.current;
    if (!chart || !d) return;
    drawingRef.current = null;
    chart.removeOverlay({ id: d.id });
    startDrawing(d.tool, d.extendData);
  };

  const overlayHandlers = (): Partial<OverlayCreate> => ({
    onDrawStart: (e) => {
      if (drawingRef.current && drawingRef.current.id === e.overlay.id) drawingRef.current.overlay = e.overlay;
    },
    onDrawEnd: (e) => {
      if (e.overlay.paneId !== CANDLE_PANE) {
        // drawn on a sub pane: discard it, the click listener below restarts the tool
        e.chart.removeOverlay({ id: e.overlay.id });
        return;
      }
      persistOverlays();
      if (drawingRef.current?.id === e.overlay.id) {
        drawingRef.current = null;
        onDrawDoneRef.current();
      }
    },
    onPressedMoveEnd: () => persistOverlays(),
    // KLineChart calls this before the overlay leaves its list, so it is excluded by id
    onRemoved: (e) => persistOverlays(e.overlay.id),
    onRightClick: (e) => {
      e.chart.removeOverlay({ id: e.overlay.id });
    },
  });

  const startDrawing = (tool: string, extendData?: unknown) => {
    const chart = chartRef.current;
    if (!chart) return;
    const id = chart.createOverlay({ name: tool, paneId: CANDLE_PANE, extendData, ...overlayHandlers() });
    if (typeof id === "string") drawingRef.current = { tool, id, overlay: null, extendData };
  };

  const cancelDrawing = () => {
    const d = drawingRef.current;
    if (!d) return;
    drawingRef.current = null;
    chartRef.current?.removeOverlay({ id: d.id });
  };

  const sizePanes = () => {
    const chart = chartRef.current;
    const el = containerRef.current;
    if (!chart || !el) return;
    chart.setPaneOptions({ id: CANDLE_PANE, minHeight: Math.round(el.clientHeight * MAIN_PANE_SHARE) });
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    registerTemplates();
    const chart = init(el, { locale: "zh-CN", timezone: "UTC", layout: { pane: { height: SUB_PANE_HEIGHT, minHeight: 60 } } });
    if (!chart) return;
    chartRef.current = chart;
    applyTheme(chart, styleRef.current);
    sizePanes();
    // The full history arrives in one response, so there is never more to load.
    chart.setDataLoader({
      getBars: ({ type, callback }) => callback(type === "init" ? (barsRef.current as KLineData[]) : [], false),
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    chart.subscribeAction("onVisibleRangeChange", () => {
      clearTimeout(timer);
      timer = setTimeout(updateBases, 80);
    });
    chart.subscribeAction("onCrosshairChange", (data) => {
      const c = data as Crosshair;
      crosshairRef.current = typeof c.dataIndex === "number" && c.kLineData ? c.dataIndex : null;
      emitLegend();
    });
    // Drawing follows the mouse into sub panes; a click there is thrown away and the tool restarts on the main pane.
    const onClick = () =>
      setTimeout(() => {
        const d = drawingRef.current;
        if (d?.overlay && d.overlay.paneId !== CANDLE_PANE) restartDrawing();
      }, 0);
    el.addEventListener("click", onClick, true);

    const retheme = () => applyTheme(chart, styleRef.current);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", retheme);
    const resize = new ResizeObserver(() => {
      sizePanes();
      chart.resize();
    });
    resize.observe(el);

    return () => {
      clearTimeout(timer);
      el.removeEventListener("click", onClick, true);
      media.removeEventListener("change", retheme);
      resize.disconnect();
      dispose(el);
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chart lives for the component's lifetime
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars) return;
    barsRef.current = bars;
    chart.setBarSpace(initialBarSpace(containerRef.current?.clientWidth ?? 1000, tf, bars.length));
    // Both calls reset the data and pull it from barsRef through the loader above.
    chart.setSymbol({ ticker: symbolKey, pricePrecision, volumePrecision: 0 });
    chart.setPeriod(PERIODS[tf]);
    // Drawings are stored by timestamp, so they land on the nearest bar of any timeframe.
    restoringRef.current = true;
    drawingRef.current = null;
    chart.removeOverlay();
    if (overlaysRef.current.length) {
      chart.createOverlay(
        overlaysRef.current.map((o) => ({ ...o, paneId: CANDLE_PANE, styles: o.styles as OverlayCreate["styles"], ...overlayHandlers() })),
      );
    }
    restoringRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable refs
  }, [bars, symbolKey, tf, pricePrecision]);

  useEffect(() => {
    styleRef.current = chartStyle;
    if (chartRef.current) applyTheme(chartRef.current, chartStyle);
  }, [chartStyle]);

  const indicatorKey = JSON.stringify(indicators);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // Re-registering under the same name swaps in the edited formula.
    const available = new Set<string>();
    for (const template of templates) {
      registerIndicator(template as Parameters<typeof registerIndicator>[0]);
      available.add(template.name);
    }
    for (const ind of chart.getIndicators()) if (!isCompare(ind.name)) chart.removeIndicator({ id: ind.id });
    for (const spec of JSON.parse(indicatorKey) as IndicatorSpec[]) {
      if (spec.name.startsWith("F_") && !available.has(spec.name)) continue;
      if (spec.pane === "main") {
        chart.createIndicator({ name: spec.name, calcParams: spec.calcParams, paneId: CANDLE_PANE }, true);
      } else {
        chart.createIndicator({ name: spec.name, calcParams: spec.calcParams, paneId: `pane_${spec.name}` });
      }
    }
    sizePanes();
  }, [indicatorKey, templates]);

  const compareKey = JSON.stringify(compare);
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars) return;
    for (let slot = 0; slot < MAX_COMPARE; slot++) chart.removeIndicator({ name: compareName(slot) });
    basesRef.current = [];
    const entries = JSON.parse(compareKey) as KChartProps["compare"];
    entries.slice(0, MAX_COMPARE).forEach((c, slot) => {
      compareSeries[slot] = refs[c.key]?.c;
      if (!compareSeries[slot]) return;
      const pane = c.mode === "percent";
      chart.createIndicator(
        {
          name: compareName(slot),
          paneId: pane ? CANDLE_PANE : `pane_cmp_${slot}`,
          series: pane ? "price" : "normal",
          shortName: c.key,
          calcParams: [0, pane ? 0 : 1],
          visible: !c.hidden,
          styles: { lines: [{ color: c.color, size: 2 }] },
        },
        true,
      );
    });
    for (let slot = entries.length; slot < MAX_COMPARE; slot++) compareSeries[slot] = undefined;
    sizePanes();
    updateBases();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateBases reads refs
  }, [compareKey, bars, refs]);

  const percent = compare.some((c) => c.mode === "percent" && !c.hidden);
  useEffect(() => {
    chartRef.current?.overrideYAxis({ paneId: CANDLE_PANE, name: percent ? "percentage" : log ? "logarithm" : "normal", gap: { top: headroom, bottom: 0.1 } });
  }, [log, percent, headroom]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    cancelDrawing();
    if (!drawTool) return;
    const extendData = drawTool === "simpleAnnotation" ? window.prompt("标注文字") : undefined;
    if (drawTool === "simpleAnnotation" && !extendData) {
      onDrawDoneRef.current();
      return;
    }
    startDrawing(drawTool, extendData);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one overlay per tool selection
  }, [drawTool]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || clearSeq === 0) return;
    restoringRef.current = true;
    drawingRef.current = null;
    chart.removeOverlay();
    restoringRef.current = false;
    onOverlaysChangeRef.current([]);
  }, [clearSeq]);

  return <div ref={containerRef} className="h-full w-full" />;
}
