import type { OverviewStats } from "./stats";
import type { SymbolMeta } from "./symbols";

export interface OverviewItem extends SymbolMeta {
  stats: OverviewStats | null;
}

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

export interface BarsResponse {
  symbol: SymbolMeta;
  benchmark: SymbolMeta | null;
  pricePrecision: number;
  /** Set when the refresh failed and cached bars are served instead */
  error: string | null;
  bars: ChartBar[];
}
