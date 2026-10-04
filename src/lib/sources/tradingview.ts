import TradingView from "@mathieuc/tradingview";
import { dedupeBars } from "../series";
import { tradingDay } from "../time";
import type { FetchResult, SourceAdapter } from "./types";

/** ~24 years of trading days; enough for a long-term view. */
const RANGE = 6000;
const TIMEOUT_MS = 30_000;

/**
 * Unofficial TradingView websocket client, no login. Covers what Yahoo lacks:
 * indices (HSI:HSTECH), yields (TVC:US10Y), FX (FX_IDC:USDCNH), dollar index (TVC:DXY).
 */
export const tradingview: SourceAdapter = {
  fetchDaily(ticker) {
    return new Promise<FetchResult>((resolve, reject) => {
      const client = new TradingView.Client();
      const chart = new client.Session.Chart();
      let settled = false;

      const finish = (error: Error | null, result?: FetchResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          chart.delete();
        } catch {
          // the session may already be gone after an error
        }
        void client.end();
        if (error) reject(error);
        else resolve(result!);
      };

      const timer = setTimeout(() => finish(new Error(`TradingView timeout: ${ticker}`)), TIMEOUT_MS);

      chart.onError((...args) => finish(new Error(`TradingView: ${args.map(String).join(" ")}`)));
      chart.onUpdate(() => {
        const periods = chart.periods;
        if (!periods?.length) return;
        const timeZone = chart.infos?.timezone ?? "UTC";
        const bars = periods.map((p) => ({
          t: tradingDay(p.time, timeZone),
          o: p.open,
          h: p.max,
          l: p.min,
          c: p.close,
          v: Number.isFinite(p.volume) ? p.volume : null,
        }));
        finish(null, { bars: dedupeBars(bars), name: chart.infos?.description, mode: "replace" });
      });
      chart.setMarket(ticker, { timeframe: "D", range: RANGE, adjustment: "dividends" });
    });
  },
};
