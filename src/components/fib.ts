/**
 * TradingView's Fibonacci retracement and trend-based extension: the default levels with a colour
 * each, the settings a drawing keeps in its `extendData` (design §1.3), and where the level lines
 * and the bands between them run. Pure, so it is tested without a chart.
 */
import { levelPrice, type PriceScale } from "./drawing-scale";

export interface FibLevel {
  level: number;
  color: string;
}

/** TradingView's default levels and their colours, the same for both tools. */
export const FIB_LEVELS: FibLevel[] = [
  { level: 0, color: "#787b86" },
  { level: 0.236, color: "#f23645" },
  { level: 0.382, color: "#ff9800" },
  { level: 0.5, color: "#4caf50" },
  { level: 0.618, color: "#089981" },
  { level: 0.786, color: "#00bcd4" },
  { level: 1, color: "#787b86" },
  { level: 1.618, color: "#2962ff" },
  { level: 2.618, color: "#f23645" },
  { level: 3.618, color: "#9c27b0" },
  { level: 4.236, color: "#e91e63" },
];

export const FIB_DRAWINGS = new Set(["fibonacciLine", "fibExtension"]);

export interface FibSettings {
  /** The bands between the levels are filled */
  background: boolean;
  /** Of the fill, in percent as TradingView counts it: 80 is an alpha of 0.2 */
  transparency: number;
  extendLeft: boolean;
  extendRight: boolean;
  /** TradingView's 使用单一颜色: every level in the drawing's own colour instead of one each */
  oneColor: boolean;
  /** TradingView's 反向: the levels run the other way, the points stay */
  reverse: boolean;
}

export const FIB_DEFAULTS: FibSettings = { background: true, transparency: 80, extendLeft: false, extendRight: false, oneColor: false, reverse: false };

/** A drawing's settings from its `extendData`; one that has none (never changed, or saved before these existed) has the defaults. */
export function fibSettingsOf(extendData: unknown): FibSettings {
  return { ...FIB_DEFAULTS, ...(extendData as Partial<FibSettings> | undefined) };
}

/**
 * The price of a level, a share of a move in the drawing's scale. A retracement (two prices) has 0
 * at its second point and 1 at its first, and runs on past the first; reversed, 0 is at the first
 * and it runs on past the second. An extension (three) is the move from the first point to the
 * second counted from the third; reversed, that move the other way from the third.
 */
export function fibPrice(scale: PriceScale, [a, b, c]: number[], level: number, reverse: boolean): number {
  const forward = c === undefined ? reverse : !reverse;
  const [from, to] = forward ? [a, b] : [b, a];
  return levelPrice(scale, from, to, level, c ?? from);
}

/** Where the level lines run: between the two x, and on to the pane's edge on a side that is extended. */
export function fibSpan(xa: number, xb: number, s: Pick<FibSettings, "extendLeft" | "extendRight">, width: number): [number, number] {
  const [x0, x1] = [Math.min(xa, xb), Math.max(xa, xb)];
  return [s.extendLeft ? Math.min(0, x0) : x0, s.extendRight ? Math.max(width, x1) : x1];
}

/**
 * The band between each two neighbouring levels (given in order, `y` in px), in the colour of the
 * one further along, as TradingView fills them.
 */
export function fibBands(levels: { y: number; color: string }[]): { y: number; height: number; color: string }[] {
  return levels.slice(1).map((l, i) => ({ y: Math.min(l.y, levels[i].y), height: Math.abs(l.y - levels[i].y), color: l.color }));
}
