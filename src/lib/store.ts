import { getDb } from "./db";
import type { Bar } from "./series";
import { makeKey, parseKey, type Source, type SymbolMeta } from "./symbols";

interface SymbolRow {
  key: string;
  source: Source;
  ticker: string;
  name: string;
  benchmark: string | null;
  sort: number;
  watch: number;
  synced_at: number | null;
  sync_error: string | null;
}

function toMeta(row: SymbolRow): SymbolMeta {
  return {
    key: row.key,
    source: row.source,
    ticker: row.ticker,
    name: row.name,
    benchmark: row.benchmark,
    sort: row.sort,
    watch: row.watch === 1,
    syncedAt: row.synced_at,
    syncError: row.sync_error,
  };
}

export function listWatchlist(): SymbolMeta[] {
  const rows = getDb().prepare("SELECT * FROM symbols WHERE watch = 1 ORDER BY sort, key").all() as SymbolRow[];
  return rows.map(toMeta);
}

export function getSymbol(key: string): SymbolMeta | null {
  const row = getDb().prepare("SELECT * FROM symbols WHERE key = ?").get(key) as SymbolRow | undefined;
  return row ? toMeta(row) : null;
}

/** Make sure a symbol row exists (hidden from the watchlist), e.g. for a benchmark key. */
export function ensureSymbol(key: string): SymbolMeta {
  const existing = getSymbol(key);
  if (existing) return existing;
  const { source, ticker } = parseKey(key);
  getDb()
    .prepare("INSERT INTO symbols (key, source, ticker, name, watch) VALUES (?, ?, ?, ?, 0)")
    .run(key, source, ticker, ticker);
  return getSymbol(key)!;
}

export function addToWatchlist(input: {
  source: Source;
  ticker: string;
  name?: string;
  benchmark?: string | null;
}): SymbolMeta {
  const key = makeKey(input.source, input.ticker);
  const db = getDb();
  const { next } = db.prepare("SELECT coalesce(max(sort), -1) + 1 AS next FROM symbols WHERE watch = 1").get() as {
    next: number;
  };
  db.prepare(
    `INSERT INTO symbols (key, source, ticker, name, benchmark, sort, watch)
     VALUES (@key, @source, @ticker, @name, @benchmark, @sort, 1)
     ON CONFLICT (key) DO UPDATE SET
       name = coalesce(@customName, symbols.name),
       benchmark = coalesce(@benchmark, symbols.benchmark),
       sort = CASE WHEN symbols.watch = 1 THEN symbols.sort ELSE @sort END,
       watch = 1`,
  ).run({
    key,
    source: input.source,
    ticker: input.ticker,
    name: input.name || input.ticker,
    customName: input.name || null,
    benchmark: input.benchmark || null,
    sort: next,
  });
  return getSymbol(key)!;
}

export function removeFromWatchlist(key: string): void {
  // Keep the row and its bars: the symbol may still serve as another symbol's benchmark.
  getDb().prepare("UPDATE symbols SET watch = 0 WHERE key = ?").run(key);
}

export function deleteSymbol(key: string): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare("DELETE FROM bars WHERE key = ?").run(key);
    db.prepare("DELETE FROM symbols WHERE key = ?").run(key);
  })();
}

export function readDaily(key: string): Bar[] {
  return getDb().prepare("SELECT t, o, h, l, c, v FROM bars WHERE key = ? ORDER BY t").all(key) as Bar[];
}

export function latestBarTime(key: string): number | null {
  const row = getDb().prepare("SELECT max(t) AS t FROM bars WHERE key = ?").get(key) as { t: number | null };
  return row.t;
}

export function writeBars(key: string, bars: Bar[], mode: "replace" | "merge"): void {
  const db = getDb();
  const insert = db.prepare("INSERT OR REPLACE INTO bars (key, t, o, h, l, c, v) VALUES (?, ?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    if (mode === "replace") db.prepare("DELETE FROM bars WHERE key = ?").run(key);
    for (const b of bars) insert.run(key, b.t, b.o, b.h, b.l, b.c, b.v);
  })();
}

export function markSynced(key: string, sourceName?: string): void {
  getDb()
    .prepare(
      `UPDATE symbols SET synced_at = ?, sync_error = NULL,
         name = CASE WHEN name = ticker AND ? IS NOT NULL THEN ? ELSE name END
       WHERE key = ?`,
    )
    .run(Date.now(), sourceName ?? null, sourceName ?? null, key);
}

export function markSyncError(key: string, message: string): void {
  getDb().prepare("UPDATE symbols SET sync_error = ? WHERE key = ?").run(message, key);
}
