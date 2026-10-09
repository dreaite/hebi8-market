import YahooFinance from "yahoo-finance2";
import { dedupeBars, type Bar } from "../series";
import { tradingDay } from "../time";
import { weekdaySession, type Quote, type QuoteSession, type SourceAdapter } from "./types";

const SESSIONS: Record<string, QuoteSession> = { REGULAR: "open", PRE: "pre", PREPRE: "pre", POST: "post", POSTPOST: "post", CLOSED: "closed" };

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Full daily history. The chart endpoint's OHLC is already split-adjusted and is stored as is;
 * `adjclose / close` carries the dividend factor. Raw HTTP requests get 429, the library handles
 * the cookie/crumb dance.
 */
export const yahoo: SourceAdapter = {
  async fetchDaily(ticker) {
    const result = await yf.chart(ticker, { period1: new Date("1800-01-01"), interval: "1d" });
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

  /** One request for every ticker; Yahoo leaves out symbols it does not know. */
  async quotes(tickers) {
    const rows = await yf.quote(tickers, {
      return: "array",
      fields: ["symbol", "regularMarketPrice", "regularMarketTime", "regularMarketDayHigh", "regularMarketDayLow", "marketState", "quoteType"],
    });
    const out: Record<string, Quote> = {};
    for (const q of rows) {
      if (q.regularMarketPrice == null || !q.regularMarketTime) continue;
      const session = q.quoteType === "CRYPTOCURRENCY" ? "always" : (SESSIONS[q.marketState ?? ""] ?? weekdaySession(Date.now()));
      out[q.symbol] = {
        price: q.regularMarketPrice,
        time: Math.floor(q.regularMarketTime.getTime() / 1000),
        ...(q.regularMarketDayHigh != null ? { dayHigh: q.regularMarketDayHigh } : {}),
        ...(q.regularMarketDayLow != null ? { dayLow: q.regularMarketDayLow } : {}),
        session,
      };
    }
    return out;
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
