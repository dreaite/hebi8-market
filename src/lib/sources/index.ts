import type { Source } from "../symbols";
import { binance } from "./binance";
import { tradingview } from "./tradingview";
import type { SourceAdapter } from "./types";
import { yahoo } from "./yahoo";

export const adapters: Record<Source, SourceAdapter> = {
  yahoo,
  binance,
  tv: tradingview,
};
