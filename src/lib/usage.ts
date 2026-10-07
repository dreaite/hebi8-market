/**
 * Traffic monitoring, the database side (design §1.7). Every 30 seconds the counters from
 * `traffic.ts` go into the `traffic` and `upstream` tables, one row per local day and whatever
 * tells requests apart; rows older than 90 days are deleted. After a flush the owner's optional
 * daily limits (`usage` in the root yaml) are checked and passed ones notified once per day.
 * Nothing here limits or blocks anyone: it only makes the load visible.
 */
import { getDb } from "./db";
import { USAGE_LIMITS, type UsageLimits } from "./config";
import { channelNames, channelsFor, deliver } from "./notify";
import { getSession } from "./secrets";
import type { Source } from "./symbols";
import { DAY, localDay } from "./time";
import { drainCounters, onBufferFull, type Hit, type Kind, type Origin, type UpstreamHit } from "./traffic";
import { readConfigSafe, vaultDir } from "./vault";

export const FLUSH_MS = 30_000;
export const KEEP_DAYS = 90;
const CHECK_MS = 5 * 60 * 1000;
const PRUNE_MS = 60 * 60 * 1000;

const log = (msg: string) => console.log(`[hebi8m] usage: ${msg}`);

export interface TrafficRow {
  day: number;
  origin: Origin;
  kind: Kind;
  path: string;
  visitor: string;
  /** lower case, '' when not logged in */
  login: string;
  n: number;
  last: number;
}

export interface UpstreamRow {
  day: number;
  source: Source;
  requests: number;
  failures: number;
  limited: number;
}

/** Minutes become local days and session cookies become logins; rows that end up the same are added up. */
export function trafficRows(hits: Hit[], tz: string, loginOf: (session: string) => string): TrafficRow[] {
  const rows = new Map<string, TrafficRow>();
  for (const h of hits) {
    const row: TrafficRow = { day: localDay(h.minute * 60, tz), origin: h.origin, kind: h.kind, path: h.path, visitor: h.visitor, login: loginOf(h.session), n: h.n, last: h.last };
    const key = [row.day, row.origin, row.kind, row.path, row.visitor, row.login].join("\t");
    const seen = rows.get(key);
    if (seen) {
      seen.n += row.n;
      seen.last = Math.max(seen.last, row.last);
    } else rows.set(key, row);
  }
  return [...rows.values()];
}

export function upstreamRows(hits: UpstreamHit[], tz: string): UpstreamRow[] {
  const rows = new Map<string, UpstreamRow>();
  for (const h of hits) {
    const day = localDay(h.minute * 60, tz);
    const key = `${day}\t${h.source}`;
    const row = rows.get(key) ?? { day, source: h.source, requests: 0, failures: 0, limited: 0 };
    row.requests += h.requests;
    row.failures += h.failures;
    row.limited += h.limited;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The instance's days are those of `sync.tz`, like everything else on the page. */
function instanceConfig() {
  return readConfigSafe(vaultDir()).config;
}
const instanceTz = () => instanceConfig()?.sync.tz ?? "UTC";

/** Drain the counters into the tables. */
export function flushUsage(): void {
  const { hits, upstream } = drainCounters();
  if (!hits.length && !upstream.length) return;
  const tz = instanceTz();
  const logins = new Map<string, string>();
  const loginOf = (session: string) => {
    if (!session) return "";
    if (!logins.has(session)) logins.set(session, getSession(session)?.login.toLowerCase() ?? "");
    return logins.get(session)!;
  };
  const db = getDb();
  const addTraffic = db.prepare(
    `INSERT INTO traffic (day, origin, kind, path, visitor, login, n, last) VALUES (@day, @origin, @kind, @path, @visitor, @login, @n, @last)
     ON CONFLICT (day, origin, kind, path, visitor, login) DO UPDATE SET n = n + @n, last = max(last, @last)`,
  );
  const addUpstream = db.prepare(
    `INSERT INTO upstream (day, source, requests, failures, limited) VALUES (@day, @source, @requests, @failures, @limited)
     ON CONFLICT (day, source) DO UPDATE SET requests = requests + @requests, failures = failures + @failures, limited = limited + @limited`,
  );
  const traffic = trafficRows(hits, tz, loginOf);
  const calls = upstreamRows(upstream, tz);
  db.transaction(() => {
    for (const r of traffic) addTraffic.run(r);
    for (const r of calls) addUpstream.run(r);
  })();
}

/** Rows from before the last `KEEP_DAYS` days go. */
export function pruneUsage(now = Date.now()): void {
  const cutoff = localDay(now / 1000, instanceTz()) - (KEEP_DAYS - 1) * DAY;
  const db = getDb();
  for (const table of ["traffic", "upstream", "usage_alerts"]) db.prepare(`DELETE FROM ${table} WHERE day < ?`).run(cutoff);
}

// ---------------------------------------------------------------------------- limits

export interface UsageToday {
  visitors: number;
  limited: number;
}

export interface Passed {
  kind: keyof UsageLimits;
  value: number;
  limit: number;
}

/** Limits passed today (strictly above), in the order they are listed. */
export function passedLimits(limits: UsageLimits, today: UsageToday): Passed[] {
  return (Object.keys(USAGE_LIMITS) as (keyof UsageLimits)[]).flatMap((kind) => {
    const limit = limits[kind];
    return limit !== null && today[kind] > limit ? [{ kind, value: today[kind], limit }] : [];
  });
}

export function usageMessage(passed: Passed[], link?: string): { title: string; text: string } {
  const title = "hebi8/market · 使用量提醒";
  const lines = passed.map((p) => `• 今天${USAGE_LIMITS[p.kind].replace(/^每日/, "")} ${p.value}，超过 ${p.limit}`);
  return { title, text: [title, "", ...lines, ...(link ? ["", `${link}/usage`] : [])].join("\n") };
}

export function usageToday(day: number): UsageToday {
  const db = getDb();
  const visitors = db.prepare("SELECT COUNT(DISTINCT visitor) AS n FROM traffic WHERE day = ? AND origin = 'public'").get(day) as { n: number };
  const limited = db.prepare("SELECT coalesce(SUM(limited), 0) AS n FROM upstream WHERE day = ?").get(day) as { n: number };
  return { visitors: visitors.n, limited: limited.n };
}

/** Notify the owner of limits passed today that have not been notified yet; a failed delivery tries again next time. */
export async function checkLimits(now = Date.now()): Promise<Passed[]> {
  const cfg = instanceConfig();
  if (!cfg || (cfg.usage.visitors === null && cfg.usage.limited === null)) return [];
  const day = localDay(now / 1000, cfg.sync.tz);
  const db = getDb();
  const done = new Set((db.prepare("SELECT kind FROM usage_alerts WHERE day = ?").all(day) as { kind: string }[]).map((r) => r.kind));
  const passed = passedLimits(cfg.usage, usageToday(day)).filter((p) => !done.has(p.kind));
  if (!passed.length) return [];
  const mark = () => {
    const insert = db.prepare("INSERT OR IGNORE INTO usage_alerts (kind, day) VALUES (?, ?)");
    for (const p of passed) insert.run(p.kind, day);
  };
  const { config, error } = channelsFor("", cfg.owner);
  if (error) log(`notify.json: ${error}`);
  const { title, text } = usageMessage(passed, config.link);
  log(passed.map((p) => `${p.kind} ${p.value} > ${p.limit}`).join(", "));
  if (channelNames(config).length === 0) {
    log("no notification channel configured, only logged");
    mark();
    return passed;
  }
  const delivery = await deliver(config, title, text);
  for (const f of delivery.failed) log(`notify via ${f.channel} failed: ${f.error}`);
  if (delivery.sent.length) mark();
  return passed;
}

// ---------------------------------------------------------------------------- the page

export interface DayTraffic {
  day: number;
  requests: number;
  page: number;
  prefetch: number;
  action: number;
  api: number;
  publicVisitors: number;
  tailnetVisitors: number;
  logins: number;
}

const EMPTY_DAY = { requests: 0, page: 0, prefetch: 0, action: 0, api: 0, publicVisitors: 0, tailnetVisitors: 0, logins: 0 };

/** The last `days` days up to `today`, newest first; a day without requests is all zeros. */
export function fillDays<T extends { day: number }>(rows: T[], today: number, days: number, empty: Omit<T, "day">): T[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => today - i * DAY).map((day) => byDay.get(day) ?? ({ ...empty, day } as T));
}

export function dailyTraffic(today: number, days: number): DayTraffic[] {
  const rows = getDb()
    .prepare(
      `SELECT day, SUM(n) AS requests,
         coalesce(SUM(CASE WHEN kind = 'page' THEN n END), 0) AS page,
         coalesce(SUM(CASE WHEN kind = 'prefetch' THEN n END), 0) AS prefetch,
         coalesce(SUM(CASE WHEN kind = 'action' THEN n END), 0) AS action,
         coalesce(SUM(CASE WHEN kind = 'api' THEN n END), 0) AS api,
         COUNT(DISTINCT CASE WHEN origin = 'public' THEN visitor END) AS publicVisitors,
         COUNT(DISTINCT CASE WHEN origin = 'tailnet' THEN visitor END) AS tailnetVisitors,
         COUNT(DISTINCT nullif(login, '')) AS logins
       FROM traffic WHERE day > ? GROUP BY day`,
    )
    .all(today - days * DAY) as DayTraffic[];
  return fillDays(rows, today, days, EMPTY_DAY);
}

export interface PathCount {
  path: string;
  kind: Kind;
  requests: number;
  visitors: number;
}

/** A day's busiest paths; prefetches are the router warming links, not visits. */
export function topPaths(day: number, limit = 15): PathCount[] {
  return getDb()
    .prepare(
      `SELECT path, kind, SUM(n) AS requests, COUNT(DISTINCT visitor) AS visitors FROM traffic
       WHERE day = ? AND kind != 'prefetch' GROUP BY path, kind ORDER BY requests DESC, path LIMIT ?`,
    )
    .all(day, limit) as PathCount[];
}

export interface VisitorCount {
  visitor: string;
  origin: Origin;
  requests: number;
  days: number;
  /** logins seen with this visitor, comma separated, '' for none */
  logins: string;
  last: number;
}

export function topVisitors(today: number, days: number, limit = 15): VisitorCount[] {
  return getDb()
    .prepare(
      `SELECT visitor, origin, SUM(n) AS requests, COUNT(DISTINCT day) AS days,
         coalesce(group_concat(DISTINCT nullif(login, '')), '') AS logins, MAX(last) AS last
       FROM traffic WHERE day > ? GROUP BY visitor, origin ORDER BY requests DESC LIMIT ?`,
    )
    .all(today - days * DAY, limit) as VisitorCount[];
}

/** When each login last made a request (unix seconds), within the kept days. */
export function lastSeen(): Map<string, number> {
  const rows = getDb().prepare("SELECT login, MAX(last) AS last FROM traffic WHERE login != '' GROUP BY login").all() as { login: string; last: number }[];
  return new Map(rows.map((r) => [r.login, r.last]));
}

export function dailyUpstream(today: number, days: number): UpstreamRow[] {
  return getDb().prepare("SELECT day, source, requests, failures, limited FROM upstream WHERE day > ? ORDER BY day DESC, source").all(today - days * DAY) as UpstreamRow[];
}

/** Today in the instance's timezone, as unix seconds at UTC midnight. */
export const usageDay = (now = Date.now()) => localDay(now / 1000, instanceTz());

// ---------------------------------------------------------------------------- timer

interface State {
  started: boolean;
  pending: boolean;
  checking: boolean;
  checkedAt: number;
  prunedAt: number;
}

const g = globalThis as unknown as { hebi8mUsage?: State };
const state: State = (g.hebi8mUsage ??= { started: false, pending: false, checking: false, checkedAt: 0, prunedAt: 0 });

function tick(): void {
  const now = Date.now();
  try {
    flushUsage();
    if (now - state.prunedAt >= PRUNE_MS) {
      state.prunedAt = now;
      pruneUsage(now);
    }
  } catch (err) {
    log(`flush failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (state.checking || now - state.checkedAt < CHECK_MS) return;
  state.checking = true;
  state.checkedAt = now;
  checkLimits(now)
    .catch((err) => log(`limit check failed: ${err instanceof Error ? err.message : String(err)}`))
    .finally(() => (state.checking = false));
}

/** Started once per process from instrumentation, like the scheduler; a full buffer flushes early. */
export function startUsage(): void {
  if (state.started) return;
  state.started = true;
  onBufferFull(() => {
    if (state.pending) return;
    state.pending = true;
    setImmediate(() => {
      state.pending = false;
      tick();
    });
  });
  setInterval(tick, FLUSH_MS);
}
