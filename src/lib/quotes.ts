/**
 * Intraday polling (design §2.6). Every 5 minutes the poller asks each source for the latest price
 * of every watched symbol, benchmark and alert symbol: open markets and crypto every round,
 * pre/post/closed ones hourly, new ones right away. The price goes to the `quotes` table; today's
 * unfinished daily bar is built from it in memory for the chart, the overview and the alerts,
 * never written to `bars`.
 */
import { compile } from "@/indicators/formula";
import type { SymbolStatus } from "./api-types";
import { runAlerts } from "./alerts";
import { loadDaily } from "./bars";
import { allItems, findItem, type Config } from "./config";
import type { Bar } from "./series";
import { adapters } from "./sources";
import type { Quote, QuoteSession } from "./sources/types";
import { computeStats, type Stats } from "./stats";
import { getSymbol, listSymbols, readDaily, readQuotes, writeQuotes, type QuoteRow, type SymbolRow } from "./store";
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
/**
 * Symbols per request, so a round stays a few requests per source however long the lists get:
 * Binance takes at most 100; Yahoo (one URL) and a TradingView quote session answer 150 in about a
 * second.
 */
const CHUNK = 100;

/** Today's first price and the extremes polling has seen */
interface Intraday {
  t: number;
  o: number;
  h: number;
  l: number;
}

/** A vault's overview stats on today's live bars, as long as `stamp` (quotes, syncs, the list) stays the same */
interface LiveCache {
  stamp: string;
  rows: Record<string, { stats: Stats; quotedAt: number }>;
}

interface State {
  started: boolean;
  /** When each key was last asked for, and the session it reported */
  seen: Map<string, { at: number; session: QuoteSession }>;
  failures: Map<Source, { count: number; until: number }>;
  /** Today's first price and the extremes seen by polling, per key */
  intraday: Map<string, Intraday>;
  live: Map<string, LiveCache>;
}

const g = globalThis as unknown as { hebi8mQuotes?: State };
const state: State = (g.hebi8mQuotes ??= { started: false, seen: new Map(), failures: new Map(), intraday: new Map(), live: new Map() });

const log = (msg: string) => console.log(`[hebi8m] quotes: ${msg}`);

/**
 * The real keys a round asks for: every watched symbol and its benchmark, and what enabled alerts
 * on a symbol read (synthetic ones expanded into their operands). `data:` only has daily bars.
 */
export function quoteKeys(configs: Config[]): string[] {
  const keys = new Set<string>();
  for (const cfg of configs) {
    const add = (key: string) => {
      if (!isValidKey(key)) return;
      if (isSynthetic(key)) {
        try {
          parseSynth(key.slice(1), cfg.aliases).keys.forEach(add);
        } catch {
          // reported where the symbol is shown
        }
      } else if (parseKey(key).source !== "data") keys.add(key);
    };
    for (const item of allItems(cfg)) {
      add(item.key);
      if (item.bench) add(item.bench);
    }
    for (const alert of cfg.alerts) {
      // an alert on the whole watchlist reads the watched symbols, which are in already
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

/**
 * The trading day a quote extends or adds after a last bar at `lastT`, or null when it is not
 * taken: not newer than the last daily sync (the synced bar wins), or on a day before the last bar.
 */
export function quoteDayIn(lastT: number | null | undefined, quote: QuoteRow, timeZone: string, syncedAt: number | null, kind?: string): number | null {
  if (syncedAt !== null && quote.fetchedAt <= syncedAt) return null;
  const t = quoteDay(quote.key, quote, timeZone, kind);
  return lastT != null && t < lastT ? null : t;
}

/**
 * Daily bars with today's unfinished bar from the quote: merged into the last bar when it is the
 * same trading day, appended when it is a new one. A quote older than the last daily sync is
 * ignored, the synced bar is newer. Memory only.
 */
export function withQuote(bars: Bar[], quote: QuoteRow | undefined, timeZone: string, syncedAt: number | null, seen?: Intraday, kind?: string): Bar[] {
  if (!quote) return bars;
  const last = bars.at(-1);
  const t = quoteDayIn(last?.t, quote, timeZone, syncedAt, kind);
  if (t === null) return bars;
  const same = last?.t === t ? last : null;
  const ownDay = seen?.t === t ? seen : null;
  const highs = [quote.price, quote.dayHigh, same?.h, ownDay?.h].filter((v): v is number => v !== undefined);
  const lows = [quote.price, quote.dayLow, same?.l, ownDay?.l].filter((v): v is number => v !== undefined);
  const o = quote.dayOpen ?? same?.o ?? ownDay?.o ?? quote.price;
  const bar: Bar = { t, o, h: Math.max(o, ...highs), l: Math.min(o, ...lows), c: quote.price, v: quote.dayVolume ?? same?.v ?? null, adj: 1 };
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

/**
 * Ask one source for its due keys, `CHUNK` per request. Failures back off to hourly after a few
 * rounds in a row without any answer and are logged once; the keys of a request that failed are
 * due again next round.
 */
async function fetchSource(source: Source, keys: string[], now: number): Promise<QuoteRow[]> {
  const fetchQuotes = adapters[source].quotes;
  if (!fetchQuotes) return [];
  const fail = state.failures.get(source);
  if (fail && fail.until > now) return [];
  const chunks: Map<string, string>[] = [];
  for (let i = 0; i < keys.length; i += CHUNK) chunks.push(new Map(keys.slice(i, i + CHUNK).map((k) => [parseKey(k).ticker, k])));
  const answers = await Promise.allSettled(chunks.map((byTicker) => fetchQuotes([...byTicker.keys()])));
  // when the answers arrived, not when the round began: a daily sync that ended in between is older
  const receivedAt = Date.now();
  const failed = answers.find((a) => a.status === "rejected");
  if (answers.every((a) => a.status === "rejected")) {
    const count = (fail?.count ?? 0) + 1;
    state.failures.set(source, { count, until: count >= BACKOFF_AFTER ? now + SLOW_MS : 0 });
    if (count === BACKOFF_AFTER) log(`${source} failed ${count} times in a row, asking hourly: ${failed!.reason instanceof Error ? failed!.reason.message : String(failed!.reason)}`);
    return [];
  }
  if (fail && fail.count >= BACKOFF_AFTER) log(`${source} answers again`);
  state.failures.delete(source);
  const rows: QuoteRow[] = [];
  answers.forEach((answer, i) => {
    if (answer.status === "rejected") return;
    for (const [ticker, key] of chunks[i]) {
      const q = answer.value[ticker];
      // a symbol the source left out is asked again with the slow ones
      state.seen.set(key, { at: now, session: q?.session ?? "closed" });
      if (!q) continue;
      const meta = getSymbol(key);
      remember(key, q, meta?.timezone ?? "UTC", meta?.kind ?? undefined);
      rows.push({ key, ...q, fetchedAt: receivedAt });
    }
  });
  return rows;
}

/** One round: fetch what is due, store it, then judge every vault's alerts on the live bars and have its overview stats ready. */
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
  for (const v of vaults) liveStats(v.id, v.config);
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
  state.live.clear();
}

/** A real key's quote where `withQuote` takes it (`quoteDayIn`), judged from the symbol's row alone. */
function takenQuote(quote: QuoteRow | undefined, meta: SymbolRow | null | undefined): QuoteRow | null {
  return quote && quoteDayIn(meta?.lastT, quote, meta?.timezone ?? "UTC", meta?.syncedAt ?? null, meta?.kind ?? undefined) !== null ? quote : null;
}

/** The oldest quote among the ones a key's price comes from: its own, or for a synthetic key its operands'. */
function quotedAt(key: string, aliases: Record<string, string>, quotes: Record<string, QuoteRow>, symbols: (key: string) => SymbolRow | null | undefined): number | null {
  const keys = isSynthetic(key) ? parseSynth(key.slice(1), aliases).keys : [key];
  const taken = keys.flatMap((k) => takenQuote(quotes[k], symbols(k))?.fetchedAt ?? []);
  return taken.length > 0 ? Math.min(...taken) : null;
}

/**
 * The chart's status strip: sync time and error, the last quote, and its session until the round
 * after next is overdue. A synthetic key has no sync or session of its own: it is as fresh as the
 * oldest quote its operands' prices come from.
 */
export function symbolStatus(key: string, aliases: Record<string, string> = {}, quotes = readQuotes()): SymbolStatus {
  if (isSynthetic(key)) return { syncedAt: null, syncError: null, quotedAt: quotedAt(key, aliases, quotes, getSymbol), session: null };
  const row = getSymbol(key);
  const quote = quotes[key];
  return { syncedAt: row?.syncedAt ?? null, syncError: row?.syncError ?? null, quotedAt: quote?.fetchedAt ?? null, session: currentSession(quote) };
}

/** A quote's session while polling keeps it current: three rounds for open markets and crypto, an hour and two rounds otherwise. */
function currentSession(quote: QuoteRow | undefined): QuoteSession | null {
  return quote && Date.now() - quote.fetchedAt < (FAST.includes(quote.session) ? 3 * ROUND_MS : SLOW_MS + 2 * ROUND_MS) ? quote.session : null;
}

/**
 * The overview's rows whose price comes from a quote (their own, or for a synthetic row an
 * operand's), wherever `withQuote` takes it: stats from today's live bar, so the price and the
 * changes match the chart and the alerts. Never stored: computed once after each quote round or
 * sync and kept in memory per vault, so a page view reads no bars. `status.session` is only set
 * while the quote is current; a synthetic row has none.
 */
export function liveStats(vault: string, cfg: Config, symbols = listSymbols()): Record<string, { stats: Stats; status: SymbolStatus }> {
  const quotes = readQuotes();
  const keys = allItems(cfg).map((i) => i.key);
  const newest = (values: (number | null)[]) => Math.max(0, ...values.map((v) => v ?? 0));
  const stamp = JSON.stringify([newest(Object.values(quotes).map((q) => q.fetchedAt)), newest(Object.values(symbols).map((s) => s.syncedAt)), cfg.prices, keys, cfg.aliases]);
  let cache = state.live.get(vault);
  if (cache?.stamp !== stamp) {
    const read = liveReader(quotes);
    cache = { stamp, rows: {} };
    for (const key of keys) {
      const at = quotedAt(key, cfg.aliases, quotes, (k) => symbols[k]);
      if (at === null) continue;
      const stats = computeStats(loadDaily(key, cfg.prices, cfg, read), { currency: symbols[key]?.currency ?? null });
      if (stats) cache.rows[key] = { stats, quotedAt: at };
    }
    state.live.set(vault, cache);
  }
  return Object.fromEntries(
    Object.entries(cache.rows).map(([key, { stats, quotedAt }]) => {
      const row = symbols[key];
      return [key, { stats, status: { syncedAt: row?.syncedAt ?? null, syncError: row?.syncError ?? null, quotedAt, session: isSynthetic(key) ? null : currentSession(quotes[key]) } }];
    }),
  );
}
