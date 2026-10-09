"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  dispose,
  init,
  registerIndicator,
  registerOverlay,
  type Chart,
  type Coordinate,
  type Crosshair,
  type DeepPartial,
  type Indicator,
  type IndicatorStyle,
  type IndicatorTemplate,
  type KLineData,
  type AxisRange,
  type Overlay,
  type OverlayCreate,
  type OverlayFigure,
  type Point,
  type Styles,
  type YAxisOverride,
} from "klinecharts";
import { customIndicators } from "@/indicators/custom";
import type { RefSeries } from "@/indicators/formula";
import type { ChartBar } from "@/lib/api-types";
import type { ChartStyle } from "@/lib/config";
import type { Timeframe } from "@/lib/symbols";
import type { CompareEntry, OverlaySpec } from "@/lib/vault";
import { ChartLegend, createLegendStore, type ChartLegendProps } from "./ChartLegend";
import { IconAlarm } from "./chart-icons";
import { registerDrawingTemplates, setOverlayChart, setOverlayTheme, textOf, textSizeOf } from "./chart-overlays";
import { dashOf, drawingStyles, lineOf, withAlpha } from "./drawing-style";
import { COMPARE_COLORS, MONO, OPEN_DRAWINGS, SANS, TEXT_DRAWINGS, type ChartControl, type IndicatorSpec, type LegendValue } from "./chart-types";
import { DrawingSettings, DrawingToolbar, TextEditor, type DrawingChange, type DrawingInfo } from "./DrawingToolbar";

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
  /** Bumped by 显示所有绘图: drawings hidden one by one come back too */
  revealSeq: number;
  /** Bumped when `overlays` was read again from the server (the page came back into view): drawings that differ are put back */
  reloadSeq: number;
  drawing: DrawingModes;
  /** Filled with the imperative handle for hotkeys and the bottom bar */
  controlRef: RefObject<ChartControl | null>;
  /** The price axis went to manual scale (dragged) or back to auto */
  onAutoScaleChange: (auto: boolean) => void;
  /** Everything the in-chart legend needs besides the live values */
  legend: Omit<ChartLegendProps, "store" | "onMainHeight" | "pricePrecision" | "compare">;
  /** This symbol's price alert levels: dashed lines with an alarm label on the price axis, never saved as drawings */
  alertLines: { id: string; price: number }[];
  /** 添加警报 at a price: right click on the main pane, or the alarm on a selected horizontal line */
  onAddAlert: (price: number) => void;
  /** The alarm label of an alert line was clicked */
  onEditAlert: (id: string) => void;
}

/** Alert lines live in their own overlay group, apart from the drawings. */
const ALERT_GROUP = "price_alerts";
/** Drawings whose floating toolbar offers 添加警报 (the line's price is copied). */
const PRICE_LINES = new Set(["horizontalStraightLine", "horizontalRayLine", "crossLine"]);
/** KLineChart's `currentStep` once a drawing is finished. */
const DRAW_DONE = -1;

/**
 * Per-drawing lock and hide ("lock all" and "hide all" are UI modes applied on top), and the
 * TradingView drawing an imported one came from: kept beside KLineChart, which has no field for them.
 */
type DrawingFlags = { lock?: boolean; hidden?: boolean; tvId?: string };

/** The y-axis object behind `getYAxes`; KLineChart keeps these methods off its public type. */
interface AxisImpl {
  id: string;
  name: string;
  getRange: () => AxisRange;
  setRange: (range: AxisRange) => void;
  getAutoCalcTickFlag: () => boolean;
  setAutoCalcTickFlag: (flag: boolean) => void;
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
/**
 * Volume moved onto the main pane, as TradingView overlays it: no scale of its own on screen, the
 * bars in the bottom quarter (the range is stretched to four times the volumes).
 */
const VOLUME_AXIS: YAxisOverride = {
  needWidget: false,
  gap: { top: 0, bottom: 0 },
  createRange: ({ defaultRange: r }) => {
    const to = r.from + r.range * 4;
    return { ...r, to, range: to - r.from, realTo: to, realRange: to - r.realFrom, displayTo: to, displayRange: to - r.displayFrom };
  },
};
const compareName = (slot: number) => `CMP${slot}`;
const comparePane = (slot: number) => `pane_cmp_${slot}`;
const isCompare = (name: string) => name.startsWith("CMP");
/** Aligned closes per compare slot; templates read them by slot so overrides never merge data. */
const compareSeries: ((number | null)[] | undefined)[] = [];

let registered = false;
function registerTemplates() {
  if (registered) return;
  registered = true;
  registerDrawingTemplates();
  // TradingView's alert line: dashed across the pane, ⏰ and the price on the axis (clicking it edits)
  registerOverlay<{ id: string }>({
    name: "priceAlert",
    totalStep: 2,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding }) => ({
      type: "line",
      attrs: { coordinates: [{ x: 0, y: coordinates[0].y }, { x: bounding.width, y: coordinates[0].y }] },
      ignoreEvent: true,
    }),
    // the label starts at the axis' left edge; the clock is drawn, not an emoji, so every font shows it
    createYAxisFigures: ({ chart, overlay, coordinates }) => {
      const y = coordinates[0].y;
      const value = overlay.points[0]?.value ?? 0;
      const precision = chart.getSymbol()?.pricePrecision ?? 2;
      const still: OverlayFigure["ignoreEvent"] = ["onPressedMoveStart", "onPressedMoving", "onPressedMoveEnd", "onRightClick", "onDoubleClick"];
      const ink = { color: "#ffffff", size: 1 };
      return [
        { type: "text", attrs: { x: 0, y, text: fmtValue(value, precision, false), align: "left", baseline: "middle" }, ignoreEvent: still },
        { type: "circle", attrs: { x: 10, y, r: 4 }, styles: { style: "stroke", borderColor: "#ffffff", borderSize: 1 }, ignoreEvent: true },
        { type: "line", attrs: { coordinates: [{ x: 10, y: y - 2.5 }, { x: 10, y }, { x: 12, y: y + 1 }] }, styles: ink, ignoreEvent: true },
      ];
    },
  });
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
    overlay: {
      line: { color: accent },
      point: { color: accent, borderColor: withAlpha(accent, 0.35), activeColor: accent, activeBorderColor: withAlpha(accent, 0.35) },
      rect: { color: withAlpha(accent, 0.12), borderColor: accent },
      polygon: { color: withAlpha(accent, 0.12), borderColor: accent },
      circle: { color: withAlpha(accent, 0.12), borderColor: accent },
      arc: { color: accent },
      text: { family: SANS, backgroundColor: accent, borderColor: accent },
    },
    xAxis: axis,
    yAxis: axis,
    separator: { color: line },
  };
  chart.setStyles(dark ? "dark" : "light");
  chart.setStyles(overrides);
  setOverlayTheme({ up, down, text: cssVar("--fg") });
}

/** Points without repeats in a row (two clicks on one spot). */
function distinctPoints(points: Partial<Point>[]): Partial<Point>[] {
  return points.filter((p, i) => i === 0 || p.timestamp !== points[i - 1].timestamp || p.value !== points[i - 1].value);
}

/** A finished drawing as saved; null for one without points. */
function specOf(o: Overlay, flags: Map<string, DrawingFlags>): OverlaySpec | null {
  const points = o.points
    .filter((p) => typeof p.timestamp === "number" && typeof p.value === "number")
    .map((p) => ({ timestamp: p.timestamp!, value: p.value! }));
  if (points.length === 0) return null;
  const spec: OverlaySpec = { name: o.name, points };
  if (o.styles) spec.styles = o.styles;
  // "lock all" and "hide all" are UI modes, not properties of each drawing
  const f = flags.get(o.id);
  if (f?.lock) spec.lock = true;
  if (f?.hidden) spec.hidden = true;
  if (o.extendData !== undefined && o.extendData !== null && typeof o.extendData !== "function") spec.extendData = o.extendData;
  if (f?.tvId) spec.tvId = f.tvId;
  return spec;
}

/** Finished drawings on the main pane; `except` is one being removed right now. */
function serializeOverlays(chart: Chart, flags: Map<string, DrawingFlags>, except?: string): OverlaySpec[] {
  return chart.getOverlays().flatMap((o) => {
    if (o.paneId !== CANDLE_PANE || o.id === except || o.groupId === ALERT_GROUP || o.currentStep !== DRAW_DONE) return [];
    const spec = specOf(o, flags);
    return spec ? [spec] : [];
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
  revealSeq,
  reloadSeq,
  drawing,
  controlRef,
  onAutoScaleChange,
  legend,
  alertLines,
  onAddAlert,
  onEditAlert,
}: KChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<ChartBar[]>([]);
  const tfRef = useRef(tf);
  const precisionRef = useRef(pricePrecision);
  const styleRef = useRef(chartStyle);
  const compareRef = useRef(compare);
  const basesRef = useRef<number[]>([]);
  /** Where the pointer is, not the bar under it: scrolling and zooming move the bars under a still pointer */
  const crosshairRef = useRef<{ x: number; paneId?: string } | null>(null);
  const overlaysRef = useRef(overlays);
  const drawingModesRef = useRef(drawing);
  const restoringRef = useRef(false);
  /** The saved drawings are on the chart (once per mount: another symbol mounts a new chart) */
  const restoredRef = useRef(false);
  const flagsRef = useRef(new Map<string, DrawingFlags>());
  const selectedRef = useRef<string | null>(null);
  const drawingRef = useRef<{ tool: string; id: string; overlay: Overlay | null; extendData?: unknown } | null>(null);
  const onOverlaysChangeRef = useRef(onOverlaysChange);
  const onDrawDoneRef = useRef(onDrawDone);
  const onAutoScaleRef = useRef(onAutoScaleChange);
  const legendFrame = useRef(0);
  const [store] = useState(createLegendStore);
  const [legendHeight, setLegendHeight] = useState(24);
  /** A drawing's menu (设置 / 锁定 / 隐藏 / 删除), or the chart's own (在 X 添加警报) */
  const [menu, setMenu] = useState<({ kind: "overlay"; id: string; locked: boolean } | { kind: "chart"; price: number }) & { x: number; y: number } | null>(null);
  /** The selected drawing, for its floating toolbar */
  const [selected, setSelected] = useState<{ id: string; info: DrawingInfo } | null>(null);
  /** The 设置 dialog of a drawing */
  const [settings, setSettings] = useState<{ id: string; info: DrawingInfo } | null>(null);
  const settingsOpenRef = useRef(false);
  /** A text drawing being typed in place (absolute px in the chart box) */
  const [editor, setEditor] = useState<{ id: string; x: number; y: number; center: boolean; size: number; color: string; text: string; isNew: boolean } | null>(null);
  const overlayMenuRef = useRef(false);
  const onAddAlertRef = useRef(onAddAlert);
  const onEditAlertRef = useRef(onEditAlert);
  // Latest props for the chart callbacks; declared first so later effects see the new values.
  useEffect(() => {
    onOverlaysChangeRef.current = onOverlaysChange;
    onDrawDoneRef.current = onDrawDone;
    onAddAlertRef.current = onAddAlert;
    onEditAlertRef.current = onEditAlert;
    onAutoScaleRef.current = onAutoScaleChange;
    compareRef.current = compare;
    overlaysRef.current = overlays;
    precisionRef.current = pricePrecision;
    settingsOpenRef.current = settings !== null;
  }, [settings, onOverlaysChange, onDrawDone, onAutoScaleChange, compare, overlays, pricePrecision, onAddAlert, onEditAlert]);

  const computeLegend = () => {
    const chart = chartRef.current;
    if (!chart) return;
    const bars = barsRef.current;
    const pointer = crosshairRef.current;
    const at = pointer ? (chart.convertFromPixel([{ x: pointer.x }], { paneId: pointer.paneId }) as Partial<Point>[])[0]?.dataIndex : undefined;
    const idx = Math.max(0, Math.min(at ?? bars.length - 1, bars.length - 1));
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
      left: chart.getSize(CANDLE_PANE, "main")?.left ?? 0,
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
    onOverlaysChangeRef.current(serializeOverlays(chart, flagsRef.current, except));
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

  const overlayModes = (flags: DrawingFlags = {}): Partial<OverlayCreate> => {
    const m = drawingModesRef.current;
    return { mode: m.magnet ? "weak_magnet" : "normal", lock: Boolean(flags.lock) || m.locked, visible: !flags.hidden && !m.hidden };
  };
  const modesOf = (id: string) => overlayModes(flagsRef.current.get(id));

  /** Saved drawings onto the chart; their flags by the new ids. */
  const createDrawings = (chart: Chart, specs: OverlaySpec[]): Map<string, DrawingFlags> => {
    const flags = new Map<string, DrawingFlags>();
    if (!specs.length) return flags;
    const ids = chart.createOverlay(
      specs.map((o) => ({
        name: o.name,
        points: o.points,
        extendData: o.extendData,
        paneId: CANDLE_PANE,
        ...(o.styles ? { styles: o.styles as OverlayCreate["styles"] } : {}),
        ...overlayModes({ lock: o.lock, hidden: o.hidden }),
        ...overlayHandlers(),
      })),
    ) as (string | null)[];
    ids.forEach((id, i) => {
      const { lock, hidden, tvId } = specs[i];
      if (id && (lock || hidden || tvId)) flags.set(id, { lock, hidden, tvId });
    });
    return flags;
  };

  const overlayHandlers = (): Partial<OverlayCreate> => ({
    onDrawEnd: (e) => {
      if (e.overlay.paneId !== CANDLE_PANE) {
        // drawn on a sub pane: discard it, the click listener below restarts the tool
        e.chart.removeOverlay({ id: e.overlay.id });
        return;
      }
      // drawn while "lock all" is on: lock it like the rest once it is finished
      if (drawingModesRef.current.locked) e.chart.overrideOverlay({ id: e.overlay.id, lock: true });
      // KLineChart finishes a path on a double click, keeping the click and the cursor point on the same spot
      if (OPEN_DRAWINGS.has(e.overlay.name)) {
        const points = distinctPoints(e.overlay.points);
        if (points.length < 2) e.chart.removeOverlay({ id: e.overlay.id });
        else if (points.length < e.overlay.points.length) e.chart.overrideOverlay({ id: e.overlay.id, points });
      }
      // TradingView: place the text first, then type it in place (saved when it is committed)
      if (TEXT_DRAWINGS.has(e.overlay.name)) openEditor(e.overlay, true);
      else persistOverlays();
      if (drawingRef.current?.id === e.overlay.id) {
        drawingRef.current = null;
        onDrawDoneRef.current();
      }
    },
    // TradingView: double click edits a text in place and opens the settings of anything else
    onDoubleClick: (e) => {
      if (TEXT_DRAWINGS.has(e.overlay.name) && !e.overlay.lock) openEditor(e.overlay, false);
      else openSettings(e.overlay.id);
    },
    onPressedMoveEnd: () => persistOverlays(),
    // KLineChart calls this before the overlay leaves its list, so it is excluded by id
    onRemoved: (e) => {
      if (selectedRef.current === e.overlay.id) select(null);
      persistOverlays(e.overlay.id);
    },
    // a path still being drawn reports itself selected on every click; only finished drawings get the toolbar
    onSelected: (e) => select(e.overlay.currentStep === DRAW_DONE ? e.overlay : null),
    // KLineChart only reports a selection when it moves to another drawing, so a drawing hidden while
    // selected and shown again would not get its toolbar back: every click on a drawing selects it
    onClick: (e) => select(e.overlay),
    onDeselected: (e) => {
      if (selectedRef.current === e.overlay.id) select(null);
    },
    // TradingView: right click opens a menu instead of deleting
    onRightClick: (e) => {
      e.preventDefault?.();
      // the chart's own menu (添加警报) must not open on top of this one
      overlayMenuRef.current = true;
      if (drawingRef.current?.id === e.overlay.id) return;
      select(e.overlay);
      setMenu({ kind: "overlay", id: e.overlay.id, locked: Boolean(flagsRef.current.get(e.overlay.id)?.lock), x: (e.pageX ?? 0) - window.scrollX, y: (e.pageY ?? 0) - window.scrollY });
    },
  });

  const infoOf = (chart: Chart, o: Overlay): DrawingInfo => {
    const line = lineOf(chart, o);
    return {
      name: o.name,
      color: line.color,
      size: line.size,
      dash: dashOf(line),
      textSize: textSizeOf(o),
      text: textOf(o),
      locked: Boolean(flagsRef.current.get(o.id)?.lock),
      values: o.points.map((p) => p.value ?? 0),
    };
  };
  const overlayById = (id: string) => chartRef.current?.getOverlays({ id })[0];

  const select = (o: Overlay | null) => {
    selectedRef.current = o?.id ?? null;
    const chart = chartRef.current;
    setSelected(o && chart ? { id: o.id, info: infoOf(chart, o) } : null);
  };
  /** Re-read the selected drawing after the toolbar changed it. */
  const refreshSelected = (id: string) => {
    const o = overlayById(id);
    if (o && selectedRef.current === id) select(o);
  };

  const openSettings = (id: string) => {
    const chart = chartRef.current;
    const o = overlayById(id);
    if (chart && o) setSettings({ id, info: infoOf(chart, o) });
  };

  /** Style, text and point prices from the floating toolbar or the settings dialog. */
  const changeDrawing = (id: string, change: DrawingChange) => {
    const chart = chartRef.current;
    const o = overlayById(id);
    if (!chart || !o) return;
    const line = lineOf(chart, o);
    const styles = drawingStyles(change.color ?? line.color, change.size ?? line.size, change.dash ?? dashOf(line));
    if (TEXT_DRAWINGS.has(o.name)) styles.text = { ...styles.text, size: change.textSize ?? textSizeOf(o) };
    chart.overrideOverlay({
      id,
      styles,
      ...(change.text !== undefined ? { extendData: change.text } : {}),
      ...(change.values ? { points: o.points.map((p, i) => ({ ...p, value: change.values![i] ?? p.value })) } : {}),
    });
    persistOverlays();
    refreshSelected(id);
  };

  const setFlag = (id: string, flag: keyof DrawingFlags, on: boolean) => {
    flagsRef.current.set(id, { ...flagsRef.current.get(id), [flag]: on });
    chartRef.current?.overrideOverlay({ id, ...modesOf(id) });
    persistOverlays();
  };
  const toggleLock = (id: string) => {
    setFlag(id, "lock", !flagsRef.current.get(id)?.lock);
    refreshSelected(id);
  };
  const hideDrawing = (id: string) => {
    setFlag(id, "hidden", true);
    select(null);
  };
  const removeDrawing = (id: string) => {
    chartRef.current?.removeOverlay({ id });
    select(null);
  };

  /** Where a text drawing's box goes, in px of the chart box (a 注释's label sits 61px above its point). */
  const editorAt = (id: string): { x: number; y: number } => {
    const o = overlayById(id);
    const point = o?.points[0];
    const chart = chartRef.current;
    const at = (point ? chart?.convertToPixel({ timestamp: point.timestamp, value: point.value }, { paneId: CANDLE_PANE, absolute: true }) : {}) as Partial<Coordinate>;
    // `absolute` only adds the pane's top: x is still from the plot's left edge, after any left scale
    const left = chart?.getSize(CANDLE_PANE, "main")?.left ?? 0;
    return { x: left + (at.x ?? 0), y: (at.y ?? 0) - (o?.name === "simpleAnnotation" ? 61 : 0) };
  };

  /** Type a text drawing in place; the canvas text hides meanwhile so it is not drawn twice. */
  const openEditor = (o: Overlay, isNew: boolean) => {
    const chart = chartRef.current;
    if (!chart || !o.points[0]) return;
    const note = o.name === "simpleAnnotation";
    chart.overrideOverlay({ id: o.id, visible: false });
    setEditor({
      id: o.id,
      ...editorAt(o.id),
      center: note,
      size: textSizeOf(o),
      color: note ? cssVar("--fg") : lineOf(chart, o).color,
      text: textOf(o),
      isNew,
    });
  };
  const closeEditor = (text: string | null) => {
    const chart = chartRef.current;
    const ed = editor;
    setEditor(null);
    if (!chart || !ed) return;
    const value = text?.replace(/\s+$/, "") ?? "";
    // an empty text is no drawing, as in TradingView
    if (text !== null && !value.trim()) return chart.removeOverlay({ id: ed.id });
    if (text === null && ed.isNew) return chart.removeOverlay({ id: ed.id });
    chart.overrideOverlay({ id: ed.id, ...(text !== null ? { extendData: value } : {}), visible: modesOf(ed.id).visible });
    persistOverlays();
    refreshSelected(ed.id);
  };

  const startDrawing = (tool: string, extendData?: unknown) => {
    const chart = chartRef.current;
    if (!chart) return;
    const id = chart.createOverlay({ name: tool, paneId: CANDLE_PANE, extendData, ...overlayModes(), lock: false, ...overlayHandlers() });
    // the live object: its points and step show how far the drawing has got
    if (typeof id === "string") drawingRef.current = { tool, id, overlay: chart.getOverlays({ id })[0] ?? null, extendData };
  };

  /**
   * Finish a path or polyline at the points clicked so far (Enter, Esc or picking another
   * tool); fewer than two points is no drawing. False when no such drawing is in progress.
   */
  const finishOpenDrawing = (notify: boolean): boolean => {
    const chart = chartRef.current;
    const d = drawingRef.current;
    if (!chart || !d || !OPEN_DRAWINGS.has(d.tool)) return false;
    const o = d.overlay;
    const points = distinctPoints(o ? o.points.slice(0, Math.max(0, o.currentStep - 1)) : []);
    drawingRef.current = null;
    chart.removeOverlay({ id: d.id });
    if (points.length >= 2) {
      chart.createOverlay({ name: d.tool, paneId: CANDLE_PANE, points, ...overlayModes(), ...overlayHandlers() });
      persistOverlays();
    }
    if (notify) onDrawDoneRef.current();
    return true;
  };

  const cancelDrawing = () => {
    const d = drawingRef.current;
    if (!d || finishOpenDrawing(false)) return;
    drawingRef.current = null;
    chartRef.current?.removeOverlay({ id: d.id });
  };

  const sizePanes = () => {
    const chart = chartRef.current;
    const el = containerRef.current;
    if (!chart || !el) return;
    chart.setPaneOptions({ id: CANDLE_PANE, minHeight: Math.round(el.clientHeight * MAIN_PANE_SHARE) });
  };

  const candleAxis = () => chartRef.current?.getYAxes({ paneId: CANDLE_PANE })[0] as unknown as AxisImpl | undefined;
  const yAxisAuto = (): boolean => candleAxis()?.getAutoCalcTickFlag() ?? true;

  /** The price axis' range when the current drag began (the base KLineChart scales and pans from). */
  const gestureRef = useRef<AxisRange | null>(null);
  const patchedAxes = useRef(new WeakSet<AxisImpl>());
  /**
   * KLineChart pans and zooms a log axis in price space, so dragging the chart up and down
   * rescales it and the axis can even go negative. Replay the same move in log space: the
   * library's new range, as a fraction of the old one, is applied to the log range instead.
   */
  const patchLogAxis = () => {
    const axis = candleAxis();
    if (!axis || axis.name !== "logarithm" || patchedAxes.current.has(axis)) return;
    patchedAxes.current.add(axis);
    const setRange = axis.setRange.bind(axis);
    axis.setRange = (next) => {
      // a drag scales from the range it started with, a wheel on the price axis from the current one
      const base = gestureRef.current ?? axis.getRange();
      if (!base.range) return setRange(next);
      const realFrom = base.realFrom + ((next.from - base.from) / base.range) * base.realRange;
      const realTo = base.realTo + ((next.to - base.to) / base.range) * base.realRange;
      const from = 10 ** realFrom;
      const to = 10 ** realTo;
      setRange({ from, to, range: to - from, realFrom, realTo, realRange: realTo - realFrom, displayFrom: from, displayTo: to, displayRange: to - from });
    };
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
    const chart = chartRef.current;
    const { percent, log } = yAxisRef.current;
    gapRef.current = topGap();
    const gap = { top: gapRef.current, bottom: BOTTOM_GAP };
    // overriding the axis also puts it back on auto scale; by id, so the own scales of indicators
    // moved onto the main pane keep their kind (the left ones keep the legend's band free too)
    chart?.overrideYAxis({ paneId: CANDLE_PANE, id: candleAxis()?.id, name: percent ? "percentage" : log ? "logarithm" : "normal", gap });
    for (const axis of chart?.getYAxes({ paneId: CANDLE_PANE }).slice(1) ?? []) {
      if (axis.position === "left") chart?.overrideYAxis({ paneId: CANDLE_PANE, id: axis.id, gap });
    }
    patchLogAxis();
    onAutoScaleRef.current(true);
  };
  /** TradingView's 自动 toggle: off keeps the current price range, so the chart pans up and down. */
  const setAutoScale = (on: boolean) => {
    if (on) return applyYAxis();
    candleAxis()?.setAutoCalcTickFlag(false);
    onAutoScaleRef.current(false);
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
    setOverlayChart(chart);
    applyTheme(chart, styleRef.current);
    sizePanes();
    // The full history arrives in one response, so there is never more to load.
    chart.setDataLoader({
      getBars: ({ type, callback }) => callback(type === "init" ? (barsRef.current as KLineData[]) : [], false),
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    chart.subscribeAction("onVisibleRangeChange", () => {
      // a still pointer is over another bar now
      scheduleLegend();
      clearTimeout(timer);
      timer = setTimeout(updateBases, 80);
    });
    // KLineChart 10 hands this only the pointer ({ x, y, paneId }), not the bar under it, and stays
    // silent when the crosshair goes away: the legend finds the bar from x, and leaving the chart is heard below
    chart.subscribeAction("onCrosshairChange", (data) => {
      const { x, paneId } = data as Crosshair;
      crosshairRef.current = x === undefined ? null : { x, paneId };
      scheduleLegend();
    });
    // TradingView: off the chart, the legend goes back to the latest bar
    const onLeave = () => {
      crosshairRef.current = null;
      scheduleLegend();
    };
    el.addEventListener("mouseleave", onLeave);
    chart.subscribeAction("onPaneDrag", scheduleLegend);
    // Drawing follows the mouse into sub panes; a click there is thrown away and the tool restarts on the main pane.
    const onClick = () =>
      setTimeout(() => {
        const d = drawingRef.current;
        if (d?.overlay && d.overlay.paneId !== CANDLE_PANE) restartDrawing();
      }, 0);
    el.addEventListener("click", onClick, true);
    // a path or polyline ends on Enter; KLineChart itself finishes it on a double click
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.defaultPrevented && finishOpenDrawing(true)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    // the base of a price-axis drag or a vertical pan, before KLineChart's own mousedown takes it
    const onPress = () => {
      const range = candleAxis()?.getRange();
      gestureRef.current = range ? { ...range } : null;
    };
    const onRelease = () => {
      gestureRef.current = null;
    };
    el.addEventListener("mousedown", onPress, true);
    el.addEventListener("touchstart", onPress, { capture: true, passive: true });
    // the browser menu is no use on a canvas; drawings bring their own (onRightClick), the main pane offers 添加警报
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (overlayMenuRef.current) {
        overlayMenuRef.current = false;
        return;
      }
      const box = el.getBoundingClientRect();
      const x = e.clientX - box.left;
      const y = e.clientY - box.top;
      const pane = chart.getSize(CANDLE_PANE, "main");
      if (!pane || x < pane.left || x > pane.left + pane.width || y < pane.top || y > pane.top + pane.height) return;
      const point = chart.convertFromPixel([{ x, y }], { paneId: CANDLE_PANE, absolute: true }) as Partial<{ value: number }>[];
      const price = point[0]?.value;
      if (typeof price === "number" && Number.isFinite(price)) setMenu({ kind: "chart", price, x: e.clientX, y: e.clientY });
    };
    el.addEventListener("contextmenu", onContextMenu);
    // dragging or double-clicking the price axis switches its auto scale; report it for the 自动 button
    // (a drag may end outside the chart, so releases are heard on the window)
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    const checkAuto = () => {
      clearTimeout(checkTimer);
      checkTimer = setTimeout(() => onAutoScaleRef.current(yAxisAuto()), 30);
    };
    const onUp = () => {
      onRelease();
      checkAuto();
    };
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    el.addEventListener("dblclick", checkAuto);
    // a wheel over the price axis zooms it and so switches auto scale off
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
      el.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("keydown", onKey);
      el.removeEventListener("mousedown", onPress, true);
      el.removeEventListener("touchstart", onPress, true);
      el.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
      el.removeEventListener("dblclick", checkAuto);
      el.removeEventListener("wheel", checkAuto);
      media.removeEventListener("change", retheme);
      resize.disconnect();
      dispose(el);
      chartRef.current = null;
      setOverlayChart(null);
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
      setAutoScale,
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
      dialogOpen: () => settingsOpenRef.current,
      closeDialog: () => setSettings(null),
      deleteSelected: () => {
        const id = selectedRef.current;
        if (!id || !chartRef.current) return false;
        chartRef.current.removeOverlay({ id });
        select(null);
        return true;
      },
      capture: () => {
        const chart = chartRef.current;
        const el = containerRef.current;
        if (!chart || !el) return null;
        return { url: chart.getConvertPictureUrl(true, "png", cssVar("--card")), width: el.clientWidth, height: el.clientHeight, legend: store.get() };
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
    // ...and put the price axis back on auto scale
    onAutoScaleRef.current(true);
    // Drawings are stored by timestamp, so they land on the nearest bar of any timeframe. They are
    // restored once; when the bars reload (another timeframe or ADJ) they stay as they are, with
    // the selection, a drawing half done and a text being typed (its box moves with it).
    if (restoredRef.current) {
      // the text box follows its drawing to where it sits on the new bars
      setEditor((ed) => (ed ? { ...ed, ...editorAt(ed.id) } : ed));
      crosshairRef.current = null;
      scheduleLegend();
      return;
    }
    restoredRef.current = true;
    restoringRef.current = true;
    flagsRef.current = createDrawings(chart, overlaysRef.current);
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
        // moved up from a pane of its own: its own scale, on the left like TradingView's, or none for volume
        const yAxisId = spec.ownScale ? `axis_${spec.name}` : undefined;
        if (yAxisId) chart.createYAxis({ id: yAxisId, paneId: CANDLE_PANE, ...(spec.name === "VOL" ? VOLUME_AXIS : { position: "left", gap: { top: gapRef.current, bottom: BOTTOM_GAP } }) });
        chart.createIndicator(
          { name: spec.name, calcParams: spec.calcParams, paneId: CANDLE_PANE, visible, ...(yAxisId ? { yAxisId } : {}), ...(spec.precision !== undefined ? { precision: spec.precision } : {}) },
          true,
        );
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
    for (const o of chart.getOverlays({ paneId: CANDLE_PANE })) {
      if (o.id === drawingRef.current?.id || o.groupId === ALERT_GROUP) continue;
      chart.overrideOverlay({ id: o.id, ...modesOf(o.id) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the three flags
  }, [drawingKey]);

  // 显示所有绘图 also brings back the drawings hidden one by one
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || revealSeq === 0) return;
    for (const [id, f] of flagsRef.current) {
      if (!f.hidden) continue;
      flagsRef.current.set(id, { ...f, hidden: false });
      chart.overrideOverlay({ id, ...modesOf(id) });
    }
    persistOverlays();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per reveal
  }, [revealSeq]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    cancelDrawing();
    if (drawTool) startDrawing(drawTool);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one overlay per tool selection
  }, [drawTool]);

  /**
   * The saved drawings changed on the server (imported in another tab): take them over unless they
   * are what the chart has. The drawing being drawn and the text being typed stay as they are.
   */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || reloadSeq === 0 || !restoredRef.current) return;
    const specs = overlaysRef.current;
    if (JSON.stringify(serializeOverlays(chart, flagsRef.current)) === JSON.stringify(specs)) return;
    const typing = editor ? chart.getOverlays({ id: editor.id })[0] : undefined;
    let typed = typing ? JSON.stringify(specOf(typing, flagsRef.current)) : null;
    restoringRef.current = true;
    setMenu(null);
    setSettings(null);
    for (const o of chart.getOverlays({ paneId: CANDLE_PANE })) {
      if (o.groupId !== ALERT_GROUP && o.currentStep === DRAW_DONE && o.id !== typing?.id) chart.removeOverlay({ id: o.id });
    }
    // the text being typed is already on the chart
    const rest = specs.filter((s) => {
      if (typed === null || JSON.stringify(s) !== typed) return true;
      typed = null;
      return false;
    });
    const flags = createDrawings(chart, rest);
    const typingFlags = typing && flagsRef.current.get(typing.id);
    if (typing && typingFlags) flags.set(typing.id, typingFlags);
    flagsRef.current = flags;
    restoringRef.current = false;
    scheduleLegend();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per reload
  }, [reloadSeq]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || clearSeq === 0) return;
    restoringRef.current = true;
    drawingRef.current = null;
    select(null);
    // every drawing, not the alert lines
    for (const o of chart.getOverlays({ paneId: CANDLE_PANE })) if (o.groupId !== ALERT_GROUP) chart.removeOverlay({ id: o.id });
    flagsRef.current = new Map();
    restoringRef.current = false;
    onOverlaysChangeRef.current([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per clear
  }, [clearSeq]);

  // alert lines: after the bars effect above, which clears every overlay when the data changes
  const alertKey = JSON.stringify(alertLines);
  useEffect(() => {
    const chart = chartRef.current;
    const last = bars?.at(-1);
    if (!chart || !last) return;
    chart.removeOverlay({ groupId: ALERT_GROUP });
    const accent = cssVar("--accent");
    for (const line of JSON.parse(alertKey) as KChartProps["alertLines"]) {
      chart.createOverlay({
        name: "priceAlert",
        groupId: ALERT_GROUP,
        paneId: CANDLE_PANE,
        points: [{ timestamp: last.timestamp, value: line.price }],
        extendData: { id: line.id },
        styles: {
          line: { style: "dashed", dashedValue: [4, 3], size: 1, color: accent },
          text: { color: "#ffffff", backgroundColor: accent, borderColor: accent, borderRadius: 2, size: 11, family: MONO, paddingLeft: 18, paddingRight: 4, paddingTop: 2, paddingBottom: 2 },
        },
        onClick: (e) => onEditAlertRef.current((e.overlay.extendData as { id: string }).id),
      });
    }
  }, [alertKey, bars, symbolKey, tf, clearSeq]);

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
      {editor && (
        <TextEditor
          key={`editor:${editor.id}`}
          x={editor.x}
          y={editor.y}
          center={editor.center}
          size={editor.size}
          color={editor.color}
          initial={editor.text}
          onCommit={(text) => closeEditor(text)}
          onCancel={() => closeEditor(null)}
        />
      )}
      {selected && !menu && !editor && (
        <DrawingToolbar
          key={`toolbar:${selected.id}`}
          info={selected.info}
          canAlert={PRICE_LINES.has(selected.info.name)}
          onChange={(change) => changeDrawing(selected.id, change)}
          onEditText={() => {
            const o = overlayById(selected.id);
            if (o) openEditor(o, false);
          }}
          onSettings={() => openSettings(selected.id)}
          // read from the chart: the line may have been dragged since it was selected
          onAlert={() => {
            const value = overlayById(selected.id)?.points[0]?.value;
            if (value !== undefined) onAddAlertRef.current(value);
          }}
          onLock={() => toggleLock(selected.id)}
          onHide={() => hideDrawing(selected.id)}
          onDelete={() => removeDrawing(selected.id)}
        />
      )}
      {settings && (
        <DrawingSettings
          key={`settings:${settings.id}`}
          info={settings.info}
          precision={pricePrecision}
          onApply={(change) => {
            changeDrawing(settings.id, change);
            setSettings(null);
          }}
          onClose={() => setSettings(null)}
        />
      )}
      {menu && (
        <div
          role="menu"
          className="menu fixed min-w-[8rem]"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - (menu.kind === "overlay" ? 150 : 50)), right: "auto" }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.kind === "overlay" ? (
            <>
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  openSettings(menu.id);
                  setMenu(null);
                }}
              >
                设置…
              </button>
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  toggleLock(menu.id);
                  setMenu(null);
                }}
              >
                {menu.locked ? "解锁" : "锁定"}
              </button>
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  hideDrawing(menu.id);
                  setMenu(null);
                }}
              >
                隐藏
              </button>
              <button
                role="menuitem"
                className="menu-item flex items-center justify-between gap-4"
                onClick={() => {
                  removeDrawing(menu.id);
                  setMenu(null);
                }}
              >
                删除 <span className="text-[11px] text-muted">Del</span>
              </button>
            </>
          ) : (
            <button
              role="menuitem"
              className="menu-item flex items-center gap-2"
              onClick={() => {
                onAddAlertRef.current(menu.price);
                setMenu(null);
              }}
            >
              <IconAlarm size={16} />
              在 {fmtValue(menu.price, pricePrecision, false)} 添加警报
              <span className="ml-auto pl-3 text-[11px] text-muted">Alt+A</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
