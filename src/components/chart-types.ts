/** Shared by ChartView and KChart; kept free of klinecharts so the page can be server-rendered. */

export interface IndicatorSpec {
  name: string;
  pane: "main" | "sub";
  calcParams: number[];
  /** Hidden from the legend's eye toggle; the pane stays */
  hidden?: boolean;
  /** Decimals on the indicator's own axis, when KLineChart's default is too many */
  precision?: number;
}

export interface CompareLegendEntry {
  key: string;
  value: number | null;
  /** Change since the base bar (the left edge of the visible range) */
  pct: number | null;
}

/** One value of an indicator at the crosshair, colored like its line. */
export interface LegendValue {
  title: string;
  text: string;
  color: string;
}

export interface LegendIndicator {
  /** Indicator name as created on the chart (built-in name or `F_<id>`) */
  name: string;
  paneId: string;
  params: number[];
  values: LegendValue[];
}

/** What the in-chart legend shows at the crosshair (or the last bar). */
export interface LegendSnapshot {
  candle: { open: number; high: number; low: number; close: number; prevClose: number | null } | null;
  /** Top of each pane in px, relative to the chart container */
  paneTops: Record<string, number>;
  indicators: LegendIndicator[];
  compares: CompareLegendEntry[];
}

/** Imperative handle the page uses for hotkeys and the bottom bar. */
export interface ChartControl {
  /** Scroll by a fraction of the visible width; negative = towards older bars */
  scroll: (fraction: number) => void;
  zoom: (scale: number) => void;
  /** Latest bar at the right edge, default zoom, auto y-scale */
  reset: () => void;
  /** TradingView's 自动: on fits the prices to the view, off keeps the range so the chart pans vertically */
  setAutoScale: (on: boolean) => void;
  /** Fit the last `years` (null = everything) into the view; false when the bars do not fit at 1px each */
  fitRange: (years: number | null) => boolean;
  /** Remove the selected drawing; false when none is selected */
  deleteSelected: () => boolean;
}

/**
 * Readable in both themes and distinct from KLineChart's indicator palette (orange, purple,
 * blue, pink, teal); teal and rust come first so the usual one or two compares never share a
 * hue with the MA lines. Taken in order of addition.
 */
export const COMPARE_COLORS = ["#0e9aa7", "#c2410c", "#2f6fde", "#a21caf", "#65a30d", "#4b5563"];

/** Height of one indicator or compare sub pane, matching KChart's layout. */
export const SUB_PANE_HEIGHT = 100;

export interface DrawTool {
  /** KLineChart overlay name */
  name: string;
  label: string;
  /** TradingView's default hotkey, shown in the tooltip */
  hotkey?: string;
  /** `KeyboardEvent.code` used with Alt */
  code?: string;
}

/** TradingView's line tools that KLineChart has built in, in TV's toolbar order. */
export const DRAW_TOOLS: DrawTool[] = [
  { name: "segment", label: "趋势线", hotkey: "Alt+T", code: "KeyT" },
  { name: "rayLine", label: "射线" },
  { name: "straightLine", label: "延长线" },
  { name: "horizontalStraightLine", label: "水平线", hotkey: "Alt+H", code: "KeyH" },
  { name: "horizontalRayLine", label: "水平射线", hotkey: "Alt+J", code: "KeyJ" },
  { name: "verticalStraightLine", label: "垂直线", hotkey: "Alt+V", code: "KeyV" },
  { name: "fibonacciLine", label: "斐波那契回撤", hotkey: "Alt+F", code: "KeyF" },
  { name: "simpleAnnotation", label: "文字" },
];

/** Date-range buttons under the chart; null = all history. */
export const RANGES: { label: string; years: number | null }[] = [
  { label: "1年", years: 1 },
  { label: "3年", years: 3 },
  { label: "5年", years: 5 },
  { label: "10年", years: 10 },
  { label: "全部", years: null },
];
