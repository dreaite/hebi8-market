/**
 * Yahoo knows a symbol's hours for today but has no holiday table. TradingView's symbol info has
 * one per symbol, with the half days, so a Yahoo symbol borrows the calendar of a TradingView
 * symbol listed on the same exchange. Asked once per exchange and kept for a few hours; where
 * TradingView cannot be reached the symbol simply has no calendar.
 */
import { countUpstream } from "../traffic";
import { fetchCalendar } from "./tradingview";
import type { SourceMeta } from "./types";

/** Yahoo's exchange code (chart meta `exchangeName`) → a TradingView symbol that trades there. Indices follow the exchange they are computed on. */
const EXCHANGE_SYMBOL: Record<string, string> = {
  // the US venues share one calendar: Nasdaq tiers, NYSE, Arca, American, Cboe BZX, and the index feeds (S&P, Nasdaq GIDS, Dow Jones, Cboe)
  ...Object.fromEntries(["NMS", "NGM", "NCM", "NYQ", "PCX", "ASE", "BTS", "SNP", "NIM", "DJI", "WCB", "CXI"].map((code) => [code, "NASDAQ:AAPL"])),
  HKG: "HKEX:700",
  SHH: "SSE:600519",
  SHZ: "SZSE:000001",
  JPX: "TSE:7203",
  OSA: "TSE:7203",
  LSE: "LSE:VOD",
  GER: "XETR:SAP",
  PAR: "EURONEXT:MC",
  TOR: "TSX:RY",
  ASX: "ASX:BHP",
  KSC: "KRX:005930",
  TAI: "TWSE:2330",
  NSI: "NSE:RELIANCE",
  SES: "SGX:D05",
};

type Calendar = Pick<SourceMeta, "holidays" | "corrections">;

const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; calendar: Promise<Calendar | null> }>();

/** The holidays and half days of a Yahoo exchange, or null: an exchange that is not listed above, or TradingView did not answer (asked again after a few hours). */
export function exchangeCalendar(exchange: string | undefined): Promise<Calendar | null> {
  const symbol = exchange && EXCHANGE_SYMBOL[exchange];
  if (!symbol) return Promise.resolve(null);
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.calendar;
  const calendar = countUpstream("tv", () => fetchCalendar(symbol)).then(
    ({ holidays, corrections }) => ({ holidays, corrections }),
    () => null,
  );
  cache.set(symbol, { at: Date.now(), calendar });
  return calendar;
}
