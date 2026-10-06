import type { Bar } from "../series";

/** What the source knows about an instrument; stored as cache, never edited by the user. */
export interface SourceMeta {
  name?: string;
  exchange?: string;
  currency?: string;
  timezone?: string;
  kind?: string;
}

export interface FetchResult {
  /** Daily bars with the dividend factor in `adj` */
  bars: Bar[];
  meta: SourceMeta;
  /**
   * `replace`: the result is the full history and supersedes stored bars
   * (adjusted prices shift the whole history whenever a split lands).
   * `merge`: the result only covers recent bars and is upserted.
   */
  mode: "replace" | "merge";
}

export interface SearchHit {
  key: string;
  name: string;
  exchange?: string;
  kind?: string;
}

export interface SourceAdapter {
  /** @param since time of the latest stored bar, for incremental sources */
  fetchDaily(ticker: string, since: number | null): Promise<FetchResult>;
  /** @param filter source-specific category, e.g. TradingView's `index` / `cfd` / `stock` / `bond` */
  search?(query: string, filter?: string): Promise<SearchHit[]>;
}
