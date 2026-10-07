import { getDb } from "./db";
import type { Bar } from "./series";
import type { SourceMeta } from "./sources/types";
import type { Stats } from "./stats";
import { parseKey, type Source } from "./symbols";

/** Cache row: what the source told us plus sync state. Nothing user-editable lives here. */
export interface SymbolRow {
  key: string;
  source: Source;
  ticker: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  timezone: string | null;
  kind: string | null;
  syncedAt: number | null;
  syncError: string | null;
  firstT: number | null;
  lastT: number | null;
}

interface RawRow {
  key: string;
  source: Source;
  ticker: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  timezone: string | null;
  kind: string | null;
  synced_at: number | null;
  sync_error: string | null;
  first_t: number | null;
  last_t: number | null;
}

const toRow = (r: RawRow): SymbolRow => ({
  key: r.key,
  source: r.source,
  ticker: r.ticker,
  name: r.name,
  exchange: r.exchange,
  currency: r.currency,
  timezone: r.timezone,
  kind: r.kind,
  syncedAt: r.synced_at,
  syncError: r.sync_error,
  firstT: r.first_t,
  lastT: r.last_t,
});

export function getSymbol(key: string): SymbolRow | null {
  const row = getDb().prepare("SELECT * FROM symbols WHERE key = ?").get(key) as RawRow | undefined;
  return row ? toRow(row) : null;
}

export function listSymbols(): Record<string, SymbolRow> {
  const rows = getDb().prepare("SELECT * FROM symbols").all() as RawRow[];
  return Object.fromEntries(rows.map((r) => [r.key, toRow(r)]));
}

export function ensureSymbol(key: string): void {
  const { source, ticker } = parseKey(key);
  getDb().prepare("INSERT OR IGNORE INTO symbols (key, source, ticker) VALUES (?, ?, ?)").run(key, source, ticker);
}

export function readDaily(key: string): Bar[] {
  return getDb().prepare("SELECT t, o, h, l, c, v, adj FROM bars WHERE key = ? ORDER BY t").all(key) as Bar[];
}

export function latestBarTime(key: string): number | null {
  const row = getDb().prepare("SELECT max(t) AS t FROM bars WHERE key = ?").get(key) as { t: number | null };
  return row.t;
}

export function writeBars(key: string, bars: Bar[], mode: "replace" | "merge"): void {
  const db = getDb();
  const insert = db.prepare("INSERT OR REPLACE INTO bars (key, t, o, h, l, c, v, adj) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    if (mode === "replace") db.prepare("DELETE FROM bars WHERE key = ?").run(key);
    for (const b of bars) insert.run(key, b.t, b.o, b.h, b.l, b.c, b.v, b.adj);
    db.prepare(
      "UPDATE symbols SET first_t = (SELECT min(t) FROM bars WHERE key = @key), last_t = (SELECT max(t) FROM bars WHERE key = @key) WHERE key = @key",
    ).run({ key });
  })();
}

export function markSynced(key: string, meta: SourceMeta): void {
  getDb()
    .prepare(
      `UPDATE symbols SET synced_at = @now, sync_error = NULL,
         name = coalesce(@name, name), exchange = coalesce(@exchange, exchange), currency = coalesce(@currency, currency),
         timezone = coalesce(@timezone, timezone), kind = coalesce(@kind, kind)
       WHERE key = @key`,
    )
    .run({
      key,
      now: Date.now(),
      name: meta.name ?? null,
      exchange: meta.exchange ?? null,
      currency: meta.currency ?? null,
      timezone: meta.timezone ?? null,
      kind: meta.kind ?? null,
    });
}

export function markSyncError(key: string, message: string): void {
  getDb().prepare("UPDATE symbols SET sync_error = ? WHERE key = ?").run(message, key);
}

/** Stats are per vault ('' = root): conditions and the prices mode are each person's own. */
export function writeStats(vault: string, key: string, stats: Stats | null): void {
  const db = getDb();
  if (!stats) db.prepare("DELETE FROM stats WHERE vault = ? AND key = ?").run(vault, key);
  else db.prepare("INSERT OR REPLACE INTO stats (vault, key, computed_at, json) VALUES (?, ?, ?, ?)").run(vault, key, Date.now(), JSON.stringify(stats));
}

export function readAllStats(vault: string): Record<string, Stats> {
  const rows = getDb().prepare("SELECT key, json FROM stats WHERE vault = ?").all(vault) as { key: string; json: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.json) as Stats]));
}

export function maxSyncedAt(): number | null {
  return (getDb().prepare("SELECT max(synced_at) AS t FROM symbols").get() as { t: number | null }).t;
}

export function hasBars(): boolean {
  return getDb().prepare("SELECT 1 FROM bars LIMIT 1").get() !== undefined;
}
