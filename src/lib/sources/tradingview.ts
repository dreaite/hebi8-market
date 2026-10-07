import TradingView from "@mathieuc/tradingview";
import { dedupeBars } from "../series";
import { tradingDay } from "../time";
import { weekdaySession, type FetchResult, type Quote, type QuoteSession, type SourceAdapter } from "./types";

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

/** `current_session` as reported; anything else it reports (out_of_session, holiday) is closed. */
const SESSIONS: Record<string, QuoteSession> = { market: "open", pre_market: "pre", post_market: "post" };
const QUOTE_TIMEOUT_MS = 20_000;

/**
 * Latest prices over the quote session of the (reverse-engineered) websocket: its own client
 * for one round, closed when every symbol has answered or the timeout hits. Whatever arrived by
 * then is returned; nothing at all is an error.
 */
function fetchQuotes(tickers: string[]): Promise<Record<string, Quote>> {
  return new Promise((resolve, reject) => {
    const client = new TradingView.Client();
    const session = new client.Session.Quote({ customFields: ["lp", "lp_time", "high_price", "low_price", "current_session"] });
    const data: Record<string, Record<string, unknown>> = {};
    let pending = tickers.length;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.delete();
      void client.end();
      // end() leaves a socket that is still connecting (a handshake that timed out) open: close it once it connects
      if (!client.isOpen) client.onConnected(() => void client.end());
      const out: Record<string, Quote> = {};
      for (const [ticker, d] of Object.entries(data)) {
        const price = d.lp;
        if (typeof price !== "number" || !Number.isFinite(price)) continue;
        out[ticker] = {
          price,
          time: typeof d.lp_time === "number" ? d.lp_time : Math.floor(Date.now() / 1000),
          ...(typeof d.high_price === "number" ? { dayHigh: d.high_price } : {}),
          ...(typeof d.low_price === "number" ? { dayLow: d.low_price } : {}),
          session: typeof d.current_session === "string" ? (SESSIONS[d.current_session] ?? "closed") : weekdaySession(Date.now()),
        };
      }
      if (Object.keys(out).length === 0 && tickers.length > 0) reject(new Error("TradingView quote: no data"));
      else resolve(out);
    };
    const timer = setTimeout(finish, QUOTE_TIMEOUT_MS);
    const done = () => {
      if (--pending === 0) finish();
    };

    for (const ticker of tickers) {
      const market = new session.Market(ticker);
      market.onData((d) => {
        data[ticker] = { ...data[ticker], ...d };
      });
      market.onLoaded(done);
      market.onError(done);
    }
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

  quotes: fetchQuotes,

  async search(query, filter = "") {
    const hits = await TradingView.searchMarketV3(query, filter);
    return hits.slice(0, 6).map((h) => ({ key: `tv:${h.id}`, name: h.description, exchange: h.exchange, kind: h.type }));
  },
};
