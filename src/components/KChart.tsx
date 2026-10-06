"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  dispose,
  init,
  registerIndicator,
  type Chart,
  type Crosshair,
  type DeepPartial,
  type Indicator,
  type IndicatorStyle,
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
import { ChartLegend, createLegendStore, type ChartLegendProps } from "./ChartLegend";
import { COMPARE_COLORS, type ChartControl, type IndicatorSpec, type LegendValue } from "./chart-types";

export interface DrawingModes {
  magnet: boolean;
  locked: boolean;
  hidden: boolean;
}

interface KChartProps {
  symbolKey: string;
  tf: Timeframe;
  bars: ChartBar[] | null;
  pricePrecision: number;
  log: boolean;
  /** The user's % axis; compares in percent mode force it on regardless */
  percentAxis: boolean;
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
  /** A drawing finished or was abandoned, so the toolbar can go back to the cursor */
  onDrawDone: () => void;
  clearSeq: number;
  drawing: DrawingModes;
  /** Filled with the imperative handle for hotkeys and the bottom bar */
  controlRef: RefObject<ChartControl | null>;
  /** The price axis went to manual scale (dragged) or back to auto */
  onAutoScaleChange: (auto: boolean) => void;
  /** Everything the in-chart legend needs besides the live values */
  legend: Omit<ChartLegendProps, "store" | "onMainHeight" | "pricePrecision" | "compare">;
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
const MIN_BAR_SPACE = 1;
const BOTTOM_GAP = 0.1;
const MAX_COMPARE = COMPARE_COLORS.length;
const compareName = (slot: number) => `CMP${slot}`;
const comparePane = (slot: number) => `pane_cmp_${slot}`;
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
      // the React legend (ChartLegend) shows OHLC, indicator and compare values, TradingView style
      tooltip: { showRule: "none" },
    },
    indicator: {
      bars: [{ upColor: withAlpha(up, 0.55), downColor: withAlpha(down, 0.55), noChangeColor: muted }],
      tooltip: { showRule: "none" },
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
function serializeOverlays(chart: Chart, keepLock: boolean, except?: string): OverlaySpec[] {
  return chart.getOverlays().flatMap((o) => {
    if (o.paneId !== CANDLE_PANE || o.id === except) return [];
    const points = o.points
      .filter((p) => typeof p.timestamp === "number" && typeof p.value === "number")
      .map((p) => ({ timestamp: p.timestamp!, value: p.value! }));
    if (points.length === 0 || points.length < o.totalStep - 1) return []; // still being drawn
    const spec: OverlaySpec = { name: o.name, points };
    // "lock all" is a UI mode, not a property of each drawing
    if (o.lock && keepLock) spec.lock = true;
    if (o.extendData !== undefined && o.extendData !== null && typeof o.extendData !== "function") spec.extendData = o.extendData;
    return [spec];
  });
}

function fmtValue(value: number, precision: number, big: boolean): string {
  const abs = Math.abs(value);
  if (big && abs >= 1e3) {
    const [div, unit] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "K"];
    return `${(value / div).toFixed(2)}${unit}`;
  }
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

/** Values at `idx` as KLineChart's own tooltip would show them: one per titled figure, in the figure's color. */
function indicatorValues(chart: Chart, ind: Indicator, idx: number, pricePrecision: number): LegendValue[] {
  const defaults = chart.getStyles().indicator;
  const own = (ind.styles ?? {}) as Partial<IndicatorStyle>;
  const lists = {
    line: own.lines ?? defaults.lines,
    bar: own.bars ?? defaults.bars,
    circle: own.circles ?? defaults.circles,
    text: own.texts ?? defaults.texts,
  };
  const counts = { line: 0, bar: 0, circle: 0, text: 0 };
  const result = ind.result as (Record<string, unknown> | undefined)[];
  const data = result[idx] ?? {};
  const values: LegendValue[] = [];
  for (const figure of ind.figures) {
    const type = figure.type as keyof typeof lists | undefined;
    if (!type) continue;
    const kind = (type in counts ? type : "line") as keyof typeof counts;
    const list = lists[kind];
    const base = list[counts[kind]++ % list.length] as { color?: string; noChangeColor?: string };
    let color = (type === "bar" || type === "circle" ? base.noChangeColor : base.color) ?? "";
    const dynamic = figure.styles?.({
      data: { prev: result[idx - 1], current: result[idx], next: result[idx + 1] },
      indicator: ind,
      barSpace: chart.getBarSpace(),
      defaultStyles: defaults,
    } as Parameters<NonNullable<typeof figure.styles>>[0]);
    if (dynamic && typeof dynamic.color === "string") color = dynamic.color;
    if (typeof figure.title !== "string") continue;
    const v = data[figure.key];
    // price-scale lines follow the symbol; oscillators get two decimals unless the values are tiny
    const precision = ind.series === "price" ? pricePrecision : typeof v === "number" && Math.abs(v) >= 1 ? Math.min(ind.precision, 2) : ind.precision;
    values.push({
      title: figure.title.replace(/:\s*$/, ""),
      text: typeof v === "number" && Number.isFinite(v) ? fmtValue(v, precision, ind.shouldFormatBigNumber) : "—",
      color,
    });
  }
  return values;
}

export function KChart({
  symbolKey,
  tf,
  bars,
  pricePrecision,
  log,
  percentAxis,
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
  drawing,
  controlRef,
  onAutoScaleChange,
  legend,
}: KChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<ChartBar[]>([]);
  const tfRef = useRef(tf);
  const precisionRef = useRef(pricePrecision);
  const styleRef = useRef(chartStyle);
  const compareRef = useRef(compare);
  const basesRef = useRef<number[]>([]);
  const crosshairRef = useRef<number | null>(null);
  const overlaysRef = useRef(overlays);
  const drawingModesRef = useRef(drawing);
  const restoringRef = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const drawingRef = useRef<{ tool: string; id: string; overlay: Overlay | null; extendData?: unknown } | null>(null);
  const onOverlaysChangeRef = useRef(onOverlaysChange);
  const onDrawDoneRef = useRef(onDrawDone);
  const onAutoScaleRef = useRef(onAutoScaleChange);
  const legendFrame = useRef(0);
  const [store] = useState(createLegendStore);
  const [legendHeight, setLegendHeight] = useState(24);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  // Latest props for the chart callbacks; declared first so later effects see the new values.
  useEffect(() => {
    onOverlaysChangeRef.current = onOverlaysChange;
    onDrawDoneRef.current = onDrawDone;
    onAutoScaleRef.current = onAutoScaleChange;
    compareRef.current = compare;
    overlaysRef.current = overlays;
    precisionRef.current = pricePrecision;
  }, [onOverlaysChange, onDrawDone, onAutoScaleChange, compare, overlays, pricePrecision]);

  const computeLegend = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = barsRef.current;
    const idx = Math.min(crosshairRef.current ?? bars.length - 1, bars.length - 1);
    const bar = bars[idx];
    const prev = bars[idx - 1];
    const paneTops: Record<string, number> = {};
    const indicators = chart.getIndicators().flatMap((ind) => {
      if (!(ind.paneId in paneTops)) paneTops[ind.paneId] = chart.getSize(ind.paneId)?.top ?? 0;
      if (isCompare(ind.name)) return [];
      return [{ name: ind.name, paneId: ind.paneId, params: ind.calcParams as number[], values: indicatorValues(chart, ind, idx, precisionRef.current) }];
    });
    syncGap();
    store.set({
      candle: bar ? { open: bar.open, high: bar.high, low: bar.low, close: bar.close, prevClose: prev?.close ?? null } : null,
      paneTops,
      indicators,
      compares: compareRef.current.map((c, slot) => {
        const closes = compareSeries[slot];
        const value = closes?.[idx] ?? null;
        const base = closes?.[basesRef.current[slot] ?? 0];
        return { key: c.key, value, pct: value != null && base ? value / base - 1 : null };
      }),
    });
  };
  /** Indicator results and pane layout settle after KLineChart's own frame, so read them on the next one. */
  const scheduleLegend = () => {
    cancelAnimationFrame(legendFrame.current);
    legendFrame.current = requestAnimationFrame(computeLegend);
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
    scheduleLegend();
  };

  const persistOverlays = (except?: string) => {
    const chart = chartRef.current;
    if (!chart || restoringRef.current) return;
    onOverlaysChangeRef.current(serializeOverlays(chart, !drawingModesRef.current.locked, except));
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

  const overlayModes = (): Partial<OverlayCreate> => {
    const m = drawingModesRef.current;
    return { mode: m.magnet ? "weak_magnet" : "normal", lock: m.locked, visible: !m.hidden };
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
      // drawn while "lock all" is on: lock it like the rest once it is finished
      if (drawingModesRef.current.locked) e.chart.overrideOverlay({ id: e.overlay.id, lock: true });
      persistOverlays();
      if (drawingRef.current?.id === e.overlay.id) {
        drawingRef.current = null;
        onDrawDoneRef.current();
      }
    },
    onPressedMoveEnd: () => persistOverlays(),
    // KLineChart calls this before the overlay leaves its list, so it is excluded by id
    onRemoved: (e) => {
      if (selectedRef.current === e.overlay.id) selectedRef.current = null;
      persistOverlays(e.overlay.id);
    },
    onSelected: (e) => {
      selectedRef.current = e.overlay.id;
    },
    onDeselected: (e) => {
      if (selectedRef.current === e.overlay.id) selectedRef.current = null;
    },
    // TradingView: right click opens a menu instead of deleting
    onRightClick: (e) => {
      e.preventDefault?.();
      if (drawingRef.current?.id === e.overlay.id) return;
      selectedRef.current = e.overlay.id;
      setMenu({ id: e.overlay.id, x: (e.pageX ?? 0) - window.scrollX, y: (e.pageY ?? 0) - window.scrollY });
    },
  });

  const startDrawing = (tool: string, extendData?: unknown) => {
    const chart = chartRef.current;
    if (!chart) return;
    const id = chart.createOverlay({ name: tool, paneId: CANDLE_PANE, extendData, ...overlayModes(), lock: false, ...overlayHandlers() });
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

  const yAxisAuto = (): boolean => {
    const axis = chartRef.current?.getYAxes({ paneId: CANDLE_PANE })[0] as unknown as { getAutoCalcTickFlag?: () => boolean } | undefined;
    return axis?.getAutoCalcTickFlag?.() ?? true;
  };

  const percent = compare.some((c) => c.mode === "percent" && !c.hidden) || percentAxis;
  const headroom = legendHeight + 12;
  const yAxisRef = useRef({ percent, log, headroom });
  const gapRef = useRef(0);
  /**
   * KLineChart grows the value range by `top × range` (a pixel `top` is divided by the pane height
   * first), so the free band ends up smaller than asked; solve for the rate that leaves `headroom` px.
   */
  const topGap = () => {
    const px = yAxisRef.current.headroom;
    const height = chartRef.current?.getSize(CANDLE_PANE, "main")?.height ?? 0;
    return height > px * 2 ? (px * (1 + BOTTOM_GAP)) / (height - px) : px;
  };
  const applyYAxis = () => {
    const { percent, log } = yAxisRef.current;
    gapRef.current = topGap();
    // overriding the axis also puts it back on auto scale
    chartRef.current?.overrideYAxis({ paneId: CANDLE_PANE, name: percent ? "percentage" : log ? "logarithm" : "normal", gap: { top: gapRef.current, bottom: BOTTOM_GAP } });
    onAutoScaleRef.current(true);
  };
  /** Pane heights change with sub panes and resizes; keep the legend's band free while on auto scale. */
  const syncGap = () => {
    if (Math.abs(topGap() - gapRef.current) > 0.01 && yAxisAuto()) applyYAxis();
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    registerTemplates();
    const chart = init(el, {
      locale: "zh-CN",
      timezone: "UTC",
      layout: { pane: { height: SUB_PANE_HEIGHT, minHeight: 60 }, barSpaceLimit: { min: MIN_BAR_SPACE, max: 50 } },
    });
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
      scheduleLegend();
    });
    chart.subscribeAction("onPaneDrag", scheduleLegend);
    // Drawing follows the mouse into sub panes; a click there is thrown away and the tool restarts on the main pane.
    const onClick = () =>
      setTimeout(() => {
        const d = drawingRef.current;
        if (d?.overlay && d.overlay.paneId !== CANDLE_PANE) restartDrawing();
      }, 0);
    el.addEventListener("click", onClick, true);
    // the browser menu is no use on a canvas; drawings bring their own (onRightClick)
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    el.addEventListener("contextmenu", onContextMenu);
    // dragging or double-clicking the price axis switches its auto scale; report it for the 自动 button
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    const checkAuto = () => {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => onAutoScaleRef.current(yAxisAuto()), 30);
    };
    el.addEventListener("mouseup", checkAuto);
    el.addEventListener("touchend", checkAuto);
    el.addEventListener("dblclick", checkAuto);
    el.addEventListener("wheel", checkAuto, { passive: true });

    const retheme = () => applyTheme(chart, styleRef.current);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", retheme);
    const resize = new ResizeObserver(() => {
      sizePanes();
      chart.resize();
      scheduleLegend();
    });
    resize.observe(el);

    return () => {
      clearTimeout(timer);
      clearTimeout(checkTimer);
      cancelAnimationFrame(legendFrame.current);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("mouseup", checkAuto);
      el.removeEventListener("touchend", checkAuto);
      el.removeEventListener("dblclick", checkAuto);
      el.removeEventListener("wheel", checkAuto);
      media.removeEventListener("change", retheme);
      resize.disconnect();
      dispose(el);
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chart lives for the component's lifetime
  }, []);

  // the imperative handle for the page's hotkeys and bottom bar
  useEffect(() => {
    const plotWidth = () => {
      const chart = chartRef.current;
      return chart?.getSize(CANDLE_PANE, "main")?.width ?? Math.max(200, (containerRef.current?.clientWidth ?? 1000) - 80);
    };
    controlRef.current = {
      scroll: (fraction) => chartRef.current?.scrollByDistance(-fraction * plotWidth(), 150),
      zoom: (scale) => chartRef.current?.zoomAtCoordinate(scale, undefined, 150),
      reset: () => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.setBarSpace(initialBarSpace(containerRef.current?.clientWidth ?? 1000, tfRef.current, barsRef.current.length));
        chart.scrollToRealTime();
        applyYAxis();
      },
      autoScale: applyYAxis,
      fitRange: (years) => {
        const chart = chartRef.current;
        const bars = barsRef.current;
        if (!chart || bars.length === 0) return true;
        let from = 0;
        if (years !== null) {
          const cutoff = bars[bars.length - 1].timestamp - years * 365.25 * 86400000;
          from = bars.findIndex((b) => b.timestamp >= cutoff);
          if (from < 0) from = 0;
        }
        const count = bars.length - from;
        const space = (plotWidth() - chart.getOffsetRightDistance()) / count;
        chart.setBarSpace(Math.min(50, Math.max(MIN_BAR_SPACE, space)));
        chart.scrollToRealTime();
        return space >= MIN_BAR_SPACE;
      },
      deleteSelected: () => {
        const id = selectedRef.current;
        if (!id || !chartRef.current) return false;
        chartRef.current.removeOverlay({ id });
        selectedRef.current = null;
        return true;
      },
    };
    return () => {
      controlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the handle reads refs
  }, [controlRef]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars) return;
    barsRef.current = bars;
    tfRef.current = tf;
    chart.setBarSpace(initialBarSpace(containerRef.current?.clientWidth ?? 1000, tf, bars.length));
    // Both calls reset the data and pull it from barsRef through the loader above.
    chart.setSymbol({ ticker: symbolKey, pricePrecision, volumePrecision: 0 });
    chart.setPeriod(PERIODS[tf]);
    // Drawings are stored by timestamp, so they land on the nearest bar of any timeframe.
    restoringRef.current = true;
    drawingRef.current = null;
    selectedRef.current = null;
    chart.removeOverlay();
    if (overlaysRef.current.length) {
      chart.createOverlay(
        overlaysRef.current.map((o) => ({
          ...o,
          paneId: CANDLE_PANE,
          styles: o.styles as OverlayCreate["styles"],
          ...overlayModes(),
          lock: Boolean(o.lock) || drawingModesRef.current.locked,
          ...overlayHandlers(),
        })),
      );
    }
    restoringRef.current = false;
    crosshairRef.current = null;
    scheduleLegend();
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
    let order = 0;
    for (const spec of JSON.parse(indicatorKey) as IndicatorSpec[]) {
      if (spec.name.startsWith("F_") && !available.has(spec.name)) continue;
      const visible = !spec.hidden;
      if (spec.pane === "main") {
        chart.createIndicator({ name: spec.name, calcParams: spec.calcParams, paneId: CANDLE_PANE, visible }, true);
      } else {
        const paneId = `pane_${spec.name}`;
        chart.createIndicator({ name: spec.name, calcParams: spec.calcParams, paneId, visible, ...(spec.precision !== undefined ? { precision: spec.precision } : {}) });
        // indicator panes stay above compare panes however often either is re-created
        chart.setPaneOptions({ id: paneId, order: 10 + order++ });
      }
    }
    sizePanes();
    scheduleLegend();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scheduleLegend reads refs
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
          paneId: pane ? CANDLE_PANE : comparePane(slot),
          series: pane ? "price" : "normal",
          shortName: c.key,
          calcParams: [0, pane ? 0 : 1],
          visible: !c.hidden,
          styles: { lines: [{ color: c.color, size: 2 }] },
        },
        true,
      );
      if (!pane) chart.setPaneOptions({ id: comparePane(slot), order: 100 + slot });
    });
    for (let slot = entries.length; slot < MAX_COMPARE; slot++) compareSeries[slot] = undefined;
    sizePanes();
    updateBases();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateBases reads refs
  }, [compareKey, bars, refs]);

  useEffect(() => {
    yAxisRef.current = { percent, log, headroom };
    applyYAxis();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyYAxis reads the ref set here
  }, [log, percent, headroom]);

  // magnet, lock all and hide all apply to every drawing and to the ones drawn next
  const drawingKey = `${drawing.magnet}|${drawing.locked}|${drawing.hidden}`;
  useEffect(() => {
    drawingModesRef.current = drawing;
    const chart = chartRef.current;
    if (!chart) return;
    const m = overlayModes();
    for (const o of chart.getOverlays({ paneId: CANDLE_PANE })) {
      if (o.id === drawingRef.current?.id) continue;
      chart.overrideOverlay({ id: o.id, mode: m.mode, visible: m.visible, lock: m.lock });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the three flags
  }, [drawingKey]);

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
    selectedRef.current = null;
    chart.removeOverlay();
    restoringRef.current = false;
    onOverlaysChangeRef.current([]);
  }, [clearSeq]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // the right-button mousedown that opened the menu is still bubbling, so listen from the next task
    const timer = setTimeout(() => window.addEventListener("mousedown", close));
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <ChartLegend
        {...legend}
        store={store}
        pricePrecision={pricePrecision}
        compare={compare}
        onMainHeight={(h) => setLegendHeight((prev) => (Math.abs(prev - h) > 2 ? h : prev))}
      />
      {menu && (
        <div
          role="menu"
          className="menu fixed min-w-[8rem]"
          style={{ left: Math.min(menu.x, window.innerWidth - 140), top: Math.min(menu.y, window.innerHeight - 50), right: "auto" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            role="menuitem"
            className="menu-item flex items-center justify-between gap-4"
            onClick={() => {
              chartRef.current?.removeOverlay({ id: menu.id });
              setMenu(null);
            }}
          >
            删除 <span className="text-[11px] text-muted">Del</span>
          </button>
        </div>
      )}
    </div>
  );
}
