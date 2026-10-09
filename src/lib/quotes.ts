/**
 * Intraday polling for price alerts (design §2.6). Every 5 minutes the poller asks each source for
 * the latest price of the symbols that enabled alerts need: open markets and crypto every round,
 * pre/post/closed ones hourly, new ones right away. The price goes to the `quotes` table; today's
 * unfinished daily bar is built from it in memory when alerts are judged, never written to `bars`.
 */
import { compile } from "@/indicators/formula";
import type { SymbolStatus } from "./api-types";
import { runAlerts } from "./alerts";
import { loadDaily } from "./bars";
import { findItem, type Config } from "./config";
import type { Bar } from "./series";
import { adapters } from "./sources";
import type { Quote, QuoteSession } from "./sources/types";
import { computeStats, type Stats } from "./stats";
import { getSymbol, readDaily, readQuotes, writeQuotes, type QuoteRow } from "./store";
import { isSynthetic, isValidKey, parseKey, type Source } from "./symbols";
import { parseSynth } from "./synth";
import { loadVaults, type VaultConfig } from "./sync";
import { localDay } from "./time";
import { readConfig, readConfigSafe, vaultDir } from "./vault";

export const ROUND_MS = 5 * 60 * 1000;
const SLOW_MS = 60 * 60 * 1000;
/** A timer that fires a little early still counts as the next round. */
const SLACK_MS = 30 * 1000;
/** Failures in a row before a source is only asked hourly. */
const BACKOFF_AFTER = 3;
const FAST: QuoteSession[] = ["open", "always"];

/** Today's first price and the extremes polling has seen */
interface Intraday {
  t: number;
  o: number;
  h: number;
  l: number;
}

interface State {
  started: boolean;
  /** When each key was last asked for, and the session it reported */
  seen: Map<string, { at: number; session: QuoteSession }>;
  failures: Map<Source, { count: number; until: number }>;
  /** Today's first price and the extremes seen by polling, per key */
  intraday: Map<string, Intraday>;
}

const g = globalThis as unknown as { hebi8mQuotes?: State };
const state: State = (g.hebi8mQuotes ??= { started: false, seen: new Map(), failures: new Map(), intraday: new Map() });

const log = (msg: string) => console.log(`[hebi8m] quotes: ${msg}`);

/** Real keys behind every enabled alert: its symbol (synthetic ones expanded) and what its formula reads. `data:` only has daily bars. */
export function quoteKeys(configs: Config[]): string[] {
  const keys = new Set<string>();
  for (const cfg of configs) {
    const add = (key: string) => {
      if (!isValidKey(key)) return;
      if (isSynthetic(key)) {
        try {
          parseSynth(key.slice(1), cfg.aliases).keys.forEach(add);
        } catch {
          // reported where the alert is shown
        }
      } else if (parseKey(key).source !== "data") keys.add(key);
    };
    for (const alert of cfg.alerts) {
      // an alert on the whole watchlist is judged after the daily sync only
      if (!alert.enabled || !alert.key) continue;
      add(alert.key);
      if (!alert.when) continue;
      try {
        compile(alert.when, { aliases: cfg.aliases, bench: findItem(cfg, alert.key)?.bench ?? null }).refs.forEach(add);
      } catch {
        // a broken formula is reported by the alert itself
      }
    }
  }
  return [...keys];
}

/** Which keys a round fetches: never asked → now; open or always → every round; otherwise hourly. */
export function dueKeys(keys: string[], seen: State["seen"], now: number): string[] {
  return keys.filter((key) => {
    const last = seen.get(key);
    if (!last) return true;
    return now - last.at >= (FAST.includes(last.session) ? ROUND_MS : SLOW_MS) - SLACK_MS;
  });
}

/** Overnight TradingView sessions roll into the next trading day at 17:00; UTC feeds use New York's session clock. */
function quoteDay(key: string, q: Pick<Quote, "time" | "session">, timeZone: string, kind?: string): number {
  if (q.session === "always") return localDay(q.time, "UTC");
  const { source, ticker } = parseKey(key);
  const overnight = source === "tv" && (/^(TVC|FX_IDC|OANDA):/.test(ticker) || kind === "futures" || kind === "future" || kind === "forex");
  if (!overnight) return localDay(q.time, timeZone);
  const sessionZone = timeZone === "UTC" || timeZone === "Etc/UTC" ? "America/New_York" : timeZone;
  return localDay(q.time + 7 * 3600, sessionZone);
}

/** A quote stands for the price until a daily sync after it brings the real bar. */
const newerThanSync = (quote: QuoteRow | undefined, syncedAt: number | null): quote is QuoteRow => quote !== undefined && (syncedAt === null || quote.fetchedAt > syncedAt);

/**
 * Daily bars with today's unfinished bar from the quote: merged into the last bar when it is the
 * same trading day, appended when it is a new one. A quote older than the last daily sync is
 * ignored, the synced bar is newer. Memory only.
 */
export function withQuote(bars: Bar[], quote: QuoteRow | undefined, timeZone: string, syncedAt: number | null, seen?: Intraday, kind?: string): Bar[] {
  if (!newerThanSync(quote, syncedAt)) return bars;
  const t = quoteDay(quote.key, quote, timeZone, kind);
  const last = bars.at(-1);
  if (last && t < last.t) return bars;
  const same = last?.t === t ? last : null;
  const ownDay = seen?.t === t ? seen : null;
  const highs = [quote.price, quote.dayHigh, same?.h, ownDay?.h].filter((v): v is number => v !== undefined);
  const lows = [quote.price, quote.dayLow, same?.l, ownDay?.l].filter((v): v is number => v !== undefined);
  const bar: Bar = { t, o: same?.o ?? ownDay?.o ?? quote.price, h: Math.max(...highs), l: Math.min(...lows), c: quote.price, v: same?.v ?? null, adj: 1 };
  return same ? [...bars.slice(0, -1), bar] : [...bars, bar];
}

/** The daily reader for judging alerts between syncs, and for the chart and the overview. */
export function liveReader(quotes = readQuotes()): (key: string) => Bar[] {
  return (key) => {
    const meta = getSymbol(key);
    return withQuote(readDaily(key), quotes[key], meta?.timezone ?? "UTC", meta?.syncedAt ?? null, state.intraday.get(key), meta?.kind ?? undefined);
  };
}

function remember(key: string, q: Quote, timeZone: string, kind?: string): void {
  const t = quoteDay(key, q, timeZone, kind);
  const day = state.intraday.get(key);
  if (day?.t === t) state.intraday.set(key, { t, o: day.o, h: Math.max(day.h, q.price), l: Math.min(day.l, q.price) });
  else state.intraday.set(key, { t, o: q.price, h: q.price, l: q.price });
}

/** Ask one source for its due keys; failures back off to hourly after a few in a row and are logged once. */
async function fetchSource(source: Source, keys: string[], now: number): Promise<QuoteRow[]> {
  const fetchQuotes = adapters[source].quotes;
  if (!fetchQuotes) return [];
  const fail = state.failures.get(source);
  if (fail && fail.until > now) return [];
  const byTicker = new Map(keys.map((k) => [parseKey(k).ticker, k]));
  let quotes: Record<string, Quote>;
  try {
    quotes = await fetchQuotes([...byTicker.keys()]);
  } catch (err) {
    const count = (fail?.count ?? 0) + 1;
    state.failures.set(source, { count, until: count >= BACKOFF_AFTER ? now + SLOW_MS : 0 });
    if (count === BACKOFF_AFTER) log(`${source} failed ${count} times in a row, asking hourly: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
  // when the answer arrived, not when the round began: a daily sync that ended in between is older
  const receivedAt = Date.now();
  if (fail && fail.count >= BACKOFF_AFTER) log(`${source} answers again`);
  state.failures.delete(source);
  const rows: QuoteRow[] = [];
  for (const [ticker, key] of byTicker) {
    const q = quotes[ticker];
    // a symbol the source left out is asked again with the slow ones
    state.seen.set(key, { at: now, session: q?.session ?? "closed" });
    if (!q) continue;
    const meta = getSymbol(key);
    remember(key, q, meta?.timezone ?? "UTC", meta?.kind ?? undefined);
    rows.push({ key, ...q, fetchedAt: receivedAt });
  }
  return rows;
}

/** One round: fetch what is due, store it, then judge every vault's alerts on the live bars. */
export async function quoteRound(now = Date.now(), vaults: VaultConfig[] = loadVaults()): Promise<QuoteRow[]> {
  if (state.seen.size === 0) {
    // after a restart the table says what was asked when, so nothing is fetched twice at once
    for (const q of Object.values(readQuotes())) state.seen.set(q.key, { at: q.fetchedAt, session: q.session });
  }
  const due = dueKeys(quoteKeys(vaults.map((v) => v.config)), state.seen, now);
  const bySource = new Map<Source, string[]>();
  for (const key of due) {
    const source = parseKey(key).source;
    bySource.set(source, [...(bySource.get(source) ?? []), key]);
  }
  const rows = (await Promise.all([...bySource].map(([source, keys]) => fetchSource(source, keys, now)))).flat();
  if (rows.length === 0) return rows;
  writeQuotes(rows);
  const read = liveReader();
  for (const v of vaults) await runAlerts(v, () => readConfig(v.dir), "quotes", read);
  return rows;
}

/** Started once per process from instrumentation, like the daily scheduler. */
export function startQuotes(): void {
  if (state.started) return;
  state.started = true;
  const tick = async () => {
    try {
      // a broken root yaml waits for the fix; the page reports it
      if (readConfigSafe(vaultDir()).config) await quoteRound();
    } catch (err) {
      log(`round failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  setTimeout(() => void tick(), 15_000);
  setInterval(() => void tick(), ROUND_MS);
}

/** Forget what was polled (tests). */
export function resetQuotes(): void {
  state.seen.clear();
  state.failures.clear();
  state.intraday.clear();
}

/** The chart's status strip: sync time and error, the last quote, and its session until the round after next is overdue. */
export function symbolStatus(key: string, quotes = readQuotes()): SymbolStatus {
  const row = getSymbol(key);
  const quote = quotes[key];
  const current = quote && Date.now() - quote.fetchedAt < (FAST.includes(quote.session) ? 3 * ROUND_MS : SLOW_MS + 2 * ROUND_MS);
  return { syncedAt: row?.syncedAt ?? null, syncError: row?.syncError ?? null, quotedAt: quote?.fetchedAt ?? null, session: current ? quote.session : null };
}

/**
 * The overview's rows whose price comes from a quote, by the same rule as `withQuote` (newer than
 * the daily sync): stats from today's live bar, so the price and the changes match the chart and
 * the alerts. `status.session` is only set while the quote is current. Computed on read, never stored.
 */
export function liveStats(keys: string[], cfg: Config): Record<string, { stats: Stats; status: SymbolStatus }> {
  const quotes = readQuotes();
  const read = liveReader(quotes);
  const out: Record<string, { stats: Stats; status: SymbolStatus }> = {};
  for (const key of keys) {
    const meta = getSymbol(key);
    if (!newerThanSync(quotes[key], meta?.syncedAt ?? null)) continue;
    const stats = computeStats(loadDaily(key, cfg.prices, cfg, read), { currency: meta?.currency ?? null });
    if (stats) out[key] = { stats, status: symbolStatus(key, quotes) };
  }
  return out;
}
