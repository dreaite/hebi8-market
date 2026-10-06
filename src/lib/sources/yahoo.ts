import YahooFinance from "yahoo-finance2";
import { dedupeBars, type Bar } from "../series";
import { tradingDay } from "../time";
import type { SourceAdapter } from "./types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Full daily history. The chart endpoint's OHLC is already split-adjusted and is stored as is;
 * `adjclose / close` carries the dividend factor. Raw HTTP requests get 429, the library handles
 * the cookie/crumb dance.
 */
export const yahoo: SourceAdapter = {
  async fetchDaily(ticker) {
    const result = await yf.chart(ticker, { period1: new Date("1970-01-02"), interval: "1d" });
    const timeZone = result.meta.exchangeTimezoneName ?? "UTC";
    const bars: Bar[] = [];
    for (const q of result.quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null || !q.close) continue;
      bars.push({
        t: tradingDay(q.date.getTime() / 1000, timeZone),
        o: q.open,
        h: q.high,
        l: q.low,
        c: q.close,
        v: q.volume ?? null,
        adj: q.adjclose != null ? q.adjclose / q.close : 1,
      });
    }
    const meta = result.meta;
    return {
      bars: dedupeBars(bars),
      meta: {
        name: meta.longName ?? meta.shortName,
        exchange: meta.fullExchangeName ?? meta.exchangeName,
        currency: meta.currency,
        timezone: timeZone,
        kind: meta.instrumentType?.toLowerCase(),
      },
      mode: "replace",
    };
  },

  async search(query) {
    const result = await yf.search(query, { quotesCount: 8, newsCount: 0 });
    return result.quotes.flatMap((q) => {
      if (!q.isYahooFinance) return [];
      const name = q.longname ?? q.shortname ?? q.symbol;
      const kind = "quoteType" in q ? String(q.quoteType).toLowerCase() : undefined;
      return [{ key: `yahoo:${q.symbol}`, name, exchange: q.exchDisp ?? q.exchange, kind }];
    });
  },
};
