import YahooFinance from "yahoo-finance2";
import { dedupeBars, type Bar } from "../series";
import { tradingDay } from "../time";
import type { SourceAdapter } from "./types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

/**
 * Full daily history with split- and dividend-adjusted OHLC (the latest close stays real).
 * Raw HTTP requests to the chart endpoint get 429; yahoo-finance2 handles the cookie/crumb dance.
 */
export const yahoo: SourceAdapter = {
  async fetchDaily(ticker) {
    const result = await yf.chart(ticker, { period1: new Date("1970-01-02"), interval: "1d" });
    const timeZone = result.meta.exchangeTimezoneName ?? "UTC";
    const bars: Bar[] = [];
    for (const q of result.quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null || !q.close) continue;
      const factor = q.adjclose != null ? q.adjclose / q.close : 1;
      bars.push({
        t: tradingDay(q.date.getTime() / 1000, timeZone),
        o: q.open * factor,
        h: q.high * factor,
        l: q.low * factor,
        c: q.close * factor,
        v: q.volume ?? null,
      });
    }
    return {
      bars: dedupeBars(bars),
      name: result.meta.longName ?? result.meta.shortName ?? undefined,
      mode: "replace",
    };
  },
};
