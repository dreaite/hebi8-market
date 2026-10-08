/**
 * TradingView watchlists in and out (design §5.5). TradingView's 导出列表 gives a `.txt` of
 * comma-separated `EXCH:SYM` with `###section` headers; importing reads that into groups, exporting
 * writes the same format. Keys and TradingView symbols are matched through `keyIdentity` /
 * `tvIdentity`, so `yahoo:NVDA` and `NASDAQ:NVDA` count as the same symbol. Pure, for both sides.
 */
import { isSynthetic, parseKey } from "./symbols";

export interface TvSection {
  name: string;
  /** TradingView symbols in file order, repeats included */
  symbols: string[];
}

/**
 * Sections of an exported list. Symbols before the first `###` go into a section named `fallback`
 * (the file name, or「TradingView」); a section header repeated later continues the same section.
 */
export function parseTvList(text: string, fallback: string): TvSection[] {
  const sections: TvSection[] = [];
  let current: TvSection | null = null;
  for (const raw of text.replace(/^﻿/, "").split(/[,\n\r]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (token.startsWith("###")) {
      const name = token.slice(3).trim() || fallback;
      current = sections.find((s) => s.name === name) ?? null;
      if (!current) sections.push((current = { name, symbols: [] }));
      continue;
    }
    if (!current) sections.push((current = { name: fallback, symbols: [] }));
    current.symbols.push(token.toUpperCase());
  }
  return sections;
}

// ---------------------------------------------------------------------------- symbol mapping

/** Exchanges TradingView lists US stocks and ETFs under; a plain Yahoo ticker is any of them. */
const US_EXCHANGES = new Set(["NASDAQ", "NYSE", "AMEX", "NYSEARCA", "ARCA", "BATS", "CBOE", "OTC"]);

/** Yahoo suffix ↔ TradingView exchange, for listings whose code is the same on both. */
const SUFFIXES: [suffix: string, exchange: string][] = [
  [".SS", "SSE"],
  [".SZ", "SZSE"],
  [".T", "TSE"],
];

/** Indices whose codes differ between the two; the common ones only. */
const INDICES: [yahoo: string, tv: string][] = [
  ["^GSPC", "SP:SPX"],
  ["^NDX", "NASDAQ:NDX"],
  ["^IXIC", "NASDAQ:IXIC"],
  ["^DJI", "DJ:DJI"],
  ["^RUT", "TVC:RUT"],
  ["^VIX", "CBOE:VIX"],
  ["^HSI", "HSI:HSI"],
  ["^N225", "TVC:NI225"],
  ["^FTSE", "TVC:UKX"],
  ["^GDAXI", "XETR:DAX"],
];

/** Yahoo's exchange names (the cached `exchange` of a symbol) → the TradingView exchange of a US listing. */
function usExchange(name: string | null | undefined): string | null {
  const n = (name ?? "").toLowerCase().replace(/\s+/g, "");
  if (/^nasdaq|^nms|^ngm|^ncm/.test(n)) return "NASDAQ";
  if (/arca|^pcx/.test(n)) return "AMEX";
  if (/american|^amex|^ase|mkt/.test(n)) return "AMEX";
  if (/^nyse|^nyq/.test(n)) return "NYSE";
  if (/cboe|bats|bzx/.test(n)) return "BATS";
  return null;
}

function splitTv(symbol: string): [string, string] {
  const i = symbol.indexOf(":");
  return i < 0 ? ["", symbol.toUpperCase()] : [symbol.slice(0, i).toUpperCase(), symbol.slice(i + 1).toUpperCase()];
}

/**
 * What a TradingView symbol is, for telling two spellings of one listing apart: US exchanges are
 * one (`NASDAQ:NVDA` = `BATS:NVDA`), Hong Kong codes lose their leading zeros.
 */
export function tvIdentity(symbol: string): string {
  const [ex, sym] = splitTv(symbol);
  if (US_EXCHANGES.has(ex)) return `US:${sym}`;
  if (ex === "HKEX" && /^\d+$/.test(sym)) return `HKEX:${Number(sym)}`;
  return `${ex}:${sym}`;
}

/** A Yahoo ticker as TradingView writes it; `us` is the exchange for a plain (US) ticker. */
function yahooToTv(ticker: string, us: string | null): string | null {
  const index = INDICES.find(([y]) => y === ticker);
  if (index) return index[1];
  const hk = /^(\d+)\.HK$/.exec(ticker);
  if (hk) return `HKEX:${Number(hk[1])}`;
  for (const [suffix, exchange] of SUFFIXES) if (ticker.endsWith(suffix)) return `${exchange}:${ticker.slice(0, -suffix.length)}`;
  // other markets' suffixes, Yahoo's own indices (^), FX and futures (=X, =F), crypto pairs (-USD)
  if (!/^[A-Z0-9]+(-[A-Z])?$/.test(ticker) || !us) return null;
  // class shares: BRK-B on Yahoo, BRK.B on TradingView
  return `${us}:${ticker.replace("-", ".")}`;
}

/**
 * The TradingView symbol of a key, for the exported list; null when there is none (synthetic and
 * dataset symbols, markets not in the table). A plain Yahoo ticker needs its exchange, the
 * `exchange` the source reported (cached with the symbol).
 */
export function tvSymbolOf(key: string, exchange?: string | null): string | null {
  if (isSynthetic(key)) return null;
  const { source, ticker } = parseKey(key);
  if (source === "tv") return ticker.includes(":") ? ticker.toUpperCase() : null;
  if (source === "binance") return `BINANCE:${ticker}`;
  if (source === "yahoo") return yahooToTv(ticker, usExchange(exchange));
  return null;
}

/** The identity of a key (see `tvIdentity`); null for what TradingView does not have. */
export function keyIdentity(key: string): string | null {
  if (isSynthetic(key)) return null;
  const { source, ticker } = parseKey(key);
  if (source === "yahoo") {
    // any US exchange will do, the identity does not tell them apart
    const symbol = yahooToTv(ticker, "NASDAQ");
    return symbol ? tvIdentity(symbol) : null;
  }
  const symbol = tvSymbolOf(key);
  return symbol ? tvIdentity(symbol) : null;
}

/** The key a TradingView symbol is added with: always the `tv` source, which has every listing. */
export const tvKey = (symbol: string) => `tv:${symbol.toUpperCase()}`;

/** Index of watched keys by identity: where each TradingView symbol already is. */
export function watchedByIdentity(groups: { name: string; keys: string[] }[]): Map<string, { key: string; group: string }> {
  const out = new Map<string, { key: string; group: string }>();
  for (const g of groups) {
    for (const key of g.keys) {
      const id = keyIdentity(key);
      if (id && !out.has(id)) out.set(id, { key, group: g.name });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------- import plan

export type ImportMode = "merge" | "replace";

export interface PlanRow {
  symbol: string;
  /** The key written: `tv:EXCH:SYM` for a new one, the watched key for one already there */
  key: string;
  /**
   * new: added. exists: already watched (merge: left where it is in `group`; replace: that entry
   * moves here, name and bench kept). duplicate: earlier in the file, skipped.
   */
  status: "new" | "exists" | "duplicate";
  /** exists: the group it is in now; duplicate: the section it was first seen in */
  group?: string;
}

export interface PlanGroup {
  name: string;
  /** A group of that name is already there (merge adds to it) */
  existing: boolean;
  rows: PlanRow[];
}

/**
 * What an import does, row by row. A symbol is only ever in one group: one already watched (any
 * equivalent key) is not added again, and one repeated in the file keeps its first place.
 */
export function planTvImport(sections: TvSection[], watched: { name: string; keys: string[] }[], mode: ImportMode): PlanGroup[] {
  const byId = watchedByIdentity(watched);
  const seen = new Map<string, string>();
  return sections.map((section) => ({
    name: section.name,
    existing: mode === "merge" && watched.some((g) => g.name === section.name),
    rows: section.symbols.map((symbol): PlanRow => {
      const id = tvIdentity(symbol);
      const first = seen.get(id);
      if (first !== undefined) return { symbol, key: tvKey(symbol), status: "duplicate", group: first };
      seen.set(id, section.name);
      const hit = byId.get(id);
      return hit ? { symbol, key: hit.key, status: "exists", group: hit.group } : { symbol, key: tvKey(symbol), status: "new" };
    }),
  }));
}

// ---------------------------------------------------------------------------- export

export interface ExportItem {
  key: string;
  /** The exchange the source reported, needed for plain Yahoo tickers */
  exchange?: string | null;
}

export interface ExportResult {
  /** `###group,EXCH:SYM,…` on one line, as TradingView exports it */
  text: string;
  count: number;
  skipped: { key: string; group: string; reason: string }[];
}

function skipReason(key: string): string {
  if (isSynthetic(key)) return "合成标的";
  const { source } = parseKey(key);
  if (source === "data") return "数据集标的";
  if (source === "yahoo" && yahooToTv(parseKey(key).ticker, "NASDAQ")) return "交易所未知（同步一次后再导出）";
  return "没有对应的 TradingView 代码";
}

/** The watchlist as a TradingView list file; groups left empty are left out. */
export function exportTvList(groups: { name: string; items: ExportItem[] }[]): ExportResult {
  const parts: string[] = [];
  const skipped: ExportResult["skipped"] = [];
  let count = 0;
  for (const g of groups) {
    const symbols = g.items.flatMap((item) => {
      const symbol = tvSymbolOf(item.key, item.exchange);
      if (!symbol) skipped.push({ key: item.key, group: g.name, reason: skipReason(item.key) });
      return symbol ? [symbol] : [];
    });
    if (!symbols.length) continue;
    // a comma would split the header
    parts.push(`###${g.name.replace(/,/g, " ")}`, ...symbols);
    count += symbols.length;
  }
  return { text: parts.join(","), count, skipped };
}
