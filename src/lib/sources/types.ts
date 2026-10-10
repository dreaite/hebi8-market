import type { Bar } from "../series";

/** What the source knows about an instrument; stored as cache, never edited by the user. */
export interface SourceMeta {
  name?: string;
  exchange?: string;
  currency?: string;
  timezone?: string;
  kind?: string;
  /** The regular session by the exchange's clock, `HHMM-HHMM` (TradingView's notation, `1700-1600` runs overnight) or `24x7` */
  hours?: string;
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
  /** TradingView's finer kinds, e.g. `cfd`, `etf`, `crypto` */
  typespecs?: string[];
  /** TradingView logo ids (`metal/copper`, `source/NYSE`), loaded by the browser from TV's logo CDN */
  logo?: string;
  sourceLogo?: string;
}

export type QuoteSession = "open" | "closed" | "pre" | "post" | "always";

/** The latest trade, for price alerts between daily syncs (§2.6). */
export interface Quote {
  price: number;
  /** When it traded, unix seconds */
  time: number;
  /** The trading day's open, high, low and volume as the source reports them, when it does */
  dayOpen?: number;
  dayHigh?: number;
  dayLow?: number;
  dayVolume?: number;
  session: QuoteSession;
}

export interface SourceAdapter {
  /** @param since time of the latest stored bar, for incremental sources */
  fetchDaily(ticker: string, since: number | null): Promise<FetchResult>;
  /** @param filter source-specific category, e.g. TradingView's `index` / `cfd` / `stock` / `bond` */
  search?(query: string, filter?: string): Promise<SearchHit[]>;
  /** Latest prices for many tickers in one request; tickers the source does not know are left out */
  quotes?(tickers: string[]): Promise<Record<string, Quote>>;
}

/** When a source does not say: weekdays count as trading, weekends as closed. */
export const weekdaySession = (nowMs: number): QuoteSession => ([0, 6].includes(new Date(nowMs).getUTCDay()) ? "closed" : "open");
