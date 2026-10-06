import TradingView from "@mathieuc/tradingview";
import { dedupeBars } from "../series";
import { tradingDay } from "../time";
import type { FetchResult, SourceAdapter } from "./types";

/** ~24 years of trading days; enough for a long-term view. */
const RANGE = 6000;
const TIMEOUT_MS = 30_000;

/** One websocket per sync run: charts open one after another and the client closes with the last. */
let shared: { client: InstanceType<typeof TradingView.Client>; users: number } | null = null;
let queue: Promise<unknown> = Promise.resolve();

function acquire() {
  shared ??= { client: new TradingView.Client(), users: 0 };
  shared.users++;
  return shared.client;
}

function release() {
  if (shared && --shared.users === 0) {
    void shared.client.end();
    shared = null;
  }
}

function fetchChart(ticker: string): Promise<FetchResult> {
  return new Promise<FetchResult>((resolve, reject) => {
    const client = acquire();
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
      release();
      if (error) reject(error);
      else resolve(result!);
    };

    const timer = setTimeout(() => finish(new Error(`TradingView timeout: ${ticker}`)), TIMEOUT_MS);

    chart.onError((...args) => finish(new Error(`TradingView: ${args.map(String).join(" ")}`)));
    chart.onUpdate(() => {
      const periods = chart.periods;
      if (!periods?.length) return;
      const infos = chart.infos ?? {};
      const timeZone = infos.timezone ?? "UTC";
      const bars = periods.map((p) => ({
        t: tradingDay(p.time, timeZone),
        o: p.open,
        h: p.max,
        l: p.min,
        c: p.close,
        v: Number.isFinite(p.volume) ? p.volume : null,
        adj: 1,
      }));
      finish(null, {
        bars: dedupeBars(bars),
        meta: {
          name: infos.description,
          exchange: infos.exchange,
          currency: infos.currency_code,
          timezone: timeZone,
          kind: infos.type,
        },
        mode: "replace",
      });
    });
    chart.setMarket(ticker, { timeframe: "D", range: RANGE, adjustment: "splits" });
  });
}

/**
 * Unofficial TradingView websocket client, no login. Covers what Yahoo lacks:
 * indices (HSI:HSTECH), yields (TVC:US10Y), FX (FX_IDC:USDCNH), dollar index (TVC:DXY).
 */
export const tradingview: SourceAdapter = {
  fetchDaily(ticker) {
    const job = queue.then(() => fetchChart(ticker));
    queue = job.catch(() => undefined);
    return job;
  },

  async search(query) {
    const hits = await TradingView.searchMarketV3(query);
    return hits.slice(0, 8).map((h) => ({ key: `tv:${h.id}`, name: h.description, exchange: h.exchange, kind: h.type }));
  },
};
