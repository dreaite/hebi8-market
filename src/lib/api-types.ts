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

export interface BarsSymbol {
  key: string;
  name: string;
  source: Source | "expr";
  ticker: string;
  currency: string | null;
  exchange: string | null;
  bench: string | null;
  syncedAt: number | null;
  syncError: string | null;
  /** The 5-minute quote (alert symbols only) when it is newer than the last sync */
  quote: { session: QuoteSession; fetchedAt: number } | null;
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
