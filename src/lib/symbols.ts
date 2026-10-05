export const SOURCES = ["yahoo", "binance", "tv"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  yahoo: "Yahoo",
  binance: "Binance",
  tv: "TradingView",
};

export type Timeframe = "D" | "W" | "M";
export const TIMEFRAMES: Timeframe[] = ["D", "W", "M"];

export interface SymbolMeta {
  /** `${source}:${ticker}`, e.g. `yahoo:AAPL`, `binance:BTCUSDT`, `tv:TVC:US10Y` */
  key: string;
  source: Source;
  ticker: string;
  name: string;
  /** Symbol key used by the relative-strength indicator */
  benchmark: string | null;
  sort: number;
  watch: boolean;
  syncedAt: number | null;
  syncError: string | null;
}

export function isSource(value: unknown): value is Source {
  return typeof value === "string" && (SOURCES as readonly string[]).includes(value);
}

export function makeKey(source: Source, ticker: string): string {
  return `${source}:${ticker}`;
}

export function parseKey(key: string): { source: Source; ticker: string } {
  const i = key.indexOf(":");
  const source = key.slice(0, i);
  const ticker = key.slice(i + 1);
  if (i <= 0 || !isSource(source) || !ticker) {
    throw new Error(`Invalid symbol key: ${key}`);
  }
  return { source, ticker };
}

export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase();
}
