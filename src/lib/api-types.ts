import type { RefSeries } from "@/indicators/formula";
import type { QuoteSession } from "./sources/types";
import type { Source } from "./symbols";

export type { SearchHit } from "./sources/types";
export type { SearchResult } from "./search";

/** Shape expected by KLineChart, plus the aligned benchmark close for the RS indicator. */
export interface ChartBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  bench?: number;
}

/** One bar of another symbol aligned to a chart bar */
export interface RefPoint {
  o: number | null;
  h: number | null;
  l: number | null;
  c: number | null;
  v: number | null;
}

/** The chart's last bar as it is now, with the other symbols at it: what a quote round changes */
export interface BarsTail {
  bar: ChartBar;
  refs: Record<string, RefPoint>;
  /** The last daily bar's day (ms, UTC midnight) */
  lastDay: number;
}

/** How fresh a symbol's data is: the daily sync and the quote polling (a synthetic key: the oldest quote its operands' prices come from) */
export interface SymbolStatus {
  syncedAt: number | null;
  syncError: string | null;
  quotedAt: number | null;
  /** The last quote's session while polling still keeps it current */
  session: QuoteSession | null;
}

export interface BarsSymbol extends SymbolStatus {
  key: string;
  name: string;
  source: Source | "expr";
  ticker: string;
  currency: string | null;
  exchange: string | null;
  bench: string | null;
  /** The exchange's timezone and its regular session on that clock (`HHMM-HHMM` or `24x7`), for the countdown to the bar's close */
  timezone: string | null;
  hours: string | null;
  /** The last daily bar's day (ms, UTC midnight); weekly and longer bars carry their bucket's start */
  lastDay: number;
}

/** `/api/status`: the status strip, and the last bar when a timeframe is asked for */
export interface StatusResponse extends SymbolStatus {
  tail: BarsTail | null;
}

export interface BarsResponse {
  symbol: BarsSymbol;
  pricePrecision: number;
  bars: ChartBar[];
  /** Other symbols aligned to `bars`: compare targets, formula references, the benchmark */
  refs: Record<string, RefSeries>;
}
