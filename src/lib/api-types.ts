import type { RefSeries } from "@/indicators/formula";
import type { Source } from "./symbols";

export type { SearchHit } from "./sources/types";

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
  bench: string | null;
  syncedAt: number | null;
  syncError: string | null;
}

export interface BarsResponse {
  symbol: BarsSymbol;
  pricePrecision: number;
  bars: ChartBar[];
  /** Other symbols aligned to `bars`: compare targets, formula references, the benchmark */
  refs: Record<string, RefSeries>;
}
