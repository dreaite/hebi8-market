import { DAY } from "../time";
import type { Bar } from "../series";
import type { SourceAdapter } from "./types";

const BASE_URL = process.env.BINANCE_API_URL ?? "https://api.binance.com";
const PAGE = 1000;

/** Binance kline row: [openTime(ms), open, high, low, close, volume, ...] */
export function klineToBar(row: unknown[]): Bar {
  return {
    t: Math.floor(Number(row[0]) / 1000),
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
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
    return { bars, mode: since === null ? "replace" : "merge" };
  },
};
