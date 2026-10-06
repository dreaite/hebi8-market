/** Shared by ChartView and KChart; kept free of klinecharts so the page can be server-rendered. */

export interface IndicatorSpec {
  name: string;
  pane: "main" | "sub";
  calcParams: number[];
}

export interface CompareLegendEntry {
  key: string;
  value: number | null;
  /** Change since the base bar (the left edge of the visible range) */
  pct: number | null;
}

/**
 * Readable in both themes and distinct from KLineChart's indicator palette (orange, purple,
 * blue, pink, teal); teal and rust come first so the usual one or two compares never share a
 * hue with the MA lines. Taken in order of addition.
 */
export const COMPARE_COLORS = ["#0e9aa7", "#c2410c", "#2f6fde", "#a21caf", "#65a30d", "#4b5563"];

/** Height of one indicator or compare sub pane, matching KChart's layout. */
export const SUB_PANE_HEIGHT = 100;

export const DRAW_TOOLS = [
  { name: "horizontalStraightLine", label: "水平线" },
  { name: "segment", label: "线段" },
  { name: "rayLine", label: "射线" },
  { name: "straightLine", label: "趋势线" },
  { name: "fibonacciLine", label: "斐波那契" },
  { name: "simpleAnnotation", label: "文字" },
];
