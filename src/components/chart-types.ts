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

/** Readable in both themes; taken in order of addition. */
export const COMPARE_COLORS = ["#e8891d", "#8e5bd6", "#1aa39a", "#d6409f", "#c9a227", "#5b8def"];

export const DRAW_TOOLS = [
  { name: "horizontalStraightLine", label: "水平线" },
  { name: "segment", label: "线段" },
  { name: "rayLine", label: "射线" },
  { name: "straightLine", label: "趋势线" },
  { name: "fibonacciLine", label: "斐波那契" },
  { name: "simpleAnnotation", label: "文字" },
];
