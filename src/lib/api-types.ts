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

/** How fresh a symbol's data is: the daily sync and the quote polling (alert symbols only) */
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
  /** The last daily bar's day (ms, UTC midnight); weekly and longer bars carry their bucket's start */
  lastDay: number;
}

export interface BarsResponse {
  symbol: BarsSymbol;
  pricePrecision: number;
  bars: ChartBar[];
  /** Other symbols aligned to `bars`: compare targets, formula references, the benchmark */
  refs: Record<string, RefSeries>;
}
