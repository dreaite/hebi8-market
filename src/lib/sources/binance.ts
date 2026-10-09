import { DAY } from "../time";
import { countUpstream } from "../traffic";
import type { Bar } from "../series";
import type { Quote, SourceAdapter } from "./types";

const BASE_URL = process.env.BINANCE_API_URL ?? "https://api.binance.com";
const PAGE = 1000;
const QUOTES = ["USDT", "USDC", "FDUSD", "BTC", "ETH", "BNB"];

/** Binance kline row: [openTime(ms), open, high, low, close, volume, ...] */
export function klineToBar(row: unknown[]): Bar {
  return {
    t: Math.floor(Number(row[0]) / 1000),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    adj: 1,
  };
}

/** Public spot klines, no API key. Daily bars open at 00:00 UTC, so no timezone mapping needed. */
export const binance: SourceAdapter = {
  async fetchDaily(ticker, since) {
    const bars: Bar[] = [];
    // Re-fetch a few days so the still-forming candle gets replaced.
    let startTime = since === null ? 0 : (since - 3 * DAY) * 1000;
    for (;;) {
      const url = `${BASE_URL}/api/v3/klines?symbol=${encodeURIComponent(ticker)}&interval=1d&limit=${PAGE}&startTime=${startTime}`;
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) {
        throw new Error(`Binance ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      const rows = (await res.json()) as unknown[][];
      bars.push(...rows.map(klineToBar));
      if (rows.length < PAGE) break;
      startTime = Number(rows[rows.length - 1][0]) + DAY * 1000;
    }
    const quote = QUOTES.find((q) => ticker.endsWith(q));
    return {
      bars,
      meta: { name: ticker, exchange: "Binance", currency: quote, timezone: "UTC", kind: "crypto" },
      mode: since === null ? "replace" : "merge",
    };
  },

  /**
   * Last trade of every pair in one request. The 24h high/low is a rolling window, not the UTC
   * day the daily bar covers, so it is left out.
   */
  async quotes(tickers) {
    const url = `${BASE_URL}/api/v3/ticker/24hr?type=MINI&symbols=${encodeURIComponent(JSON.stringify(tickers))}`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Binance ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as { symbol: string; lastPrice: string; closeTime: number }[];
    const out: Record<string, Quote> = {};
    for (const r of rows) {
      const price = Number(r.lastPrice);
      if (Number.isFinite(price) && price > 0) out[r.symbol] = { price, time: Math.floor(r.closeTime / 1000), session: "always" };
    }
    return out;
  },

  /** Spot USDT pairs whose base starts with the query; the exact pair first. */
  async search(query) {
    const q = query.trim().toUpperCase().replace(/USDT$/, "");
    if (!/^[A-Z0-9]{1,12}$/.test(q)) return [];
    const bases = await usdtBases();
    const hit = (base: string) => ({ key: `binance:${base}USDT`, name: `${base}USDT`, exchange: "Binance", kind: "crypto", logo: `crypto/XTVC${base}`, sourceLogo: "source/BINANCE" });
    if (bases === null) return /^[A-Z0-9]{2,12}$/.test(q) ? [hit(q)] : [];
    return bases
      .filter((b) => b.startsWith(q))
      .sort((a, b) => Number(b === q) - Number(a === q) || a.length - b.length || a.localeCompare(b))
      .slice(0, 6)
      .map(hit);
  },
};

const TICKER_TTL = 24 * 60 * 60 * 1000;
let tickers: { at: number; bases: string[] } | null = null;
let loading: Promise<string[] | null> | null = null;

/** Base assets of every spot USDT pair, from the 160KB ticker list, cached for a day. */
async function usdtBases(): Promise<string[] | null> {
  if (tickers && Date.now() - tickers.at < TICKER_TTL) return tickers.bases;
  loading ??= (async () => {
    try {
      // counted here, not around search(): a cached list is no request, and a failure falls back below
      const rows = await countUpstream("binance", async () => {
        const res = await fetch(`${BASE_URL}/api/v3/ticker/price`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Binance ${res.status}`);
        return (await res.json()) as { symbol: string }[];
      });
      const bases = rows.map((r) => r.symbol).filter((s) => s.endsWith("USDT")).map((s) => s.slice(0, -4));
      tickers = { at: Date.now(), bases };
      return bases;
    } catch {
      return tickers?.bases ?? null;
    } finally {
      loading = null;
    }
  })();
  return loading;
}
