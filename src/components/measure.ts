/**
 * The numbers of the measuring tools: a price change, and what TradingView's 测量 (Shift + click)
 * shows between two points. Pure, so it is tested without a chart.
 */

const signed = (v: number, text: string) => (v > 0 ? `+${text}` : text);

export const pct = (from: number, to: number) => (from ? ((to - from) / Math.abs(from)) * 100 : 0);

/** "+12.50 (+5.00%)" from one price to another. */
export function priceChangeText(from: number, to: number, precision: number): string {
  const diff = (to - from).toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
  return `${signed(to - from, diff)} (${signed(to - from, pct(from, to).toFixed(2))}%)`;
}

/**
 * The volume of the bars from index `a` to `b`, both included and in either order; the part of the
 * range past the data has none. Null when no bar there has a volume (an index, a synthetic symbol).
 */
export function volumeBetween(volumes: (number | null | undefined)[], a: number, b: number): number | null {
  const known = volumes.slice(Math.max(0, Math.min(a, b)), Math.max(a, b) + 1).filter((v) => typeof v === "number");
  return known.length ? known.reduce((sum, v) => sum + v, 0) : null;
}

function volumeText(v: number): string {
  if (v < 1e3) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const [div, unit] = v >= 1e9 ? [1e9, "B"] : v >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  return `${(v / div).toFixed(2)}${unit}`;
}

export interface Measured {
  /** Real prices, whatever the axis shows (log, percent) */
  from: number;
  to: number;
  /** Bars and calendar days from the first point to the second; negative backwards */
  bars: number;
  days: number;
  volume: number | null;
}

/** The lines of the ruler's box: price change, bars and days, and the volume when the symbol has one. */
export function measureLines(m: Measured, precision: number): string[] {
  return [priceChangeText(m.from, m.to, precision), `${m.bars} 根K线，${m.days}d`, ...(m.volume === null ? [] : [`成交量 ${volumeText(m.volume)}`])];
}
