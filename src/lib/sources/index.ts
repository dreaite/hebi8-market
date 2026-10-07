import type { Source } from "../symbols";
import { countUpstream } from "../traffic";
import { binance } from "./binance";
import { dataset } from "./dataset";
import { tradingview } from "./tradingview";
import type { SourceAdapter } from "./types";
import { yahoo } from "./yahoo";

/** Every call is counted per source and day (§1.7): requests, failures, and which of those look rate limited. */
function counted(source: Source, adapter: SourceAdapter): SourceAdapter {
  const { fetchDaily, search, quotes } = adapter;
  return {
    fetchDaily: (ticker, since) => countUpstream(source, () => fetchDaily.call(adapter, ticker, since)),
    ...(search && { search: (query, filter) => countUpstream(source, () => search.call(adapter, query, filter)) }),
    ...(quotes && { quotes: (tickers) => countUpstream(source, () => quotes.call(adapter, tickers)) }),
  };
}

export const adapters: Record<Source, SourceAdapter> = {
  yahoo: counted("yahoo", yahoo),
  binance: counted("binance", binance),
  tv: counted("tv", tradingview),
  // reads files on disk; only the git fetch of a remote dataset is counted, in dataset.ts
  data: dataset,
};
