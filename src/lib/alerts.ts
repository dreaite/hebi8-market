/**
 * Alerts (§2.5, §2.6): the `alerts` list. One on a symbol is judged when a daily sync ends and after
 * every 5-minute quote round, on daily bars whose last one is today's unfinished bar; one without a
 * key covers every watched symbol and is judged when a daily sync ends. State lives in the
 * `alert_state` table, per vault, so a restart does not repeat a message, event conditions compare
 * with the previous check, and the overview can tell which alerts fired when.
 */
import { isMap, isSeq, type Document, type YAMLSeq } from "yaml";
import { crossed, observe, ALERT_CONDS, type AlertCondition, type AlertTrigger } from "./alert-conds";
import { loadDaily, type DailyReader } from "./bars";
import { evalRule, type SeriesCache } from "./conditions";
import { allItems, conditionAsAlert, parseAlert, type AlertDef, type Config } from "./config";
import { getDb } from "./db";
import { nameOf } from "./names";
import { channelNames, channelsFor, deliver, formatDigest, type AlertEvent } from "./notify";
import type { ConditionResult } from "./stats";
import { listSymbols, readDaily } from "./store";
import type { Timeframe } from "./symbols";
import { readConfig, updateConfig, type VaultRef } from "./vault";

export interface StateRow {
  /** 0/1 for formulas and states; an event's position (-1, 0, 1, see `observe`) */
  state: number;
  firedBar: number | null;
  /** When it last fired (ms), as committed */
  firedAt?: number | null;
}

type Decision = { fire: boolean; next: StateRow | null };

/**
 * Formula alerts (`when`), pure. Unknown results leave the row alone;
 * the first sighting only records; a rule fires when it turns true, at most once per bar (a
 * weekly condition that flickers inside the unfinished week fires once).
 */
export function decide(row: StateRow | undefined, result: Pick<ConditionResult, "now" | "t">): Decision {
  if (result.now === null) return { fire: false, next: null };
  const now = result.now;
  const t = result.t ?? null;
  if (!row) return { fire: false, next: { state: now ? 1 : 0, firedBar: now ? t : null } };
  if (now && row.state === 0 && row.firedBar !== t) return { fire: true, next: { state: 1, firedBar: t } };
  return { fire: false, next: { state: now ? 1 : 0, firedBar: row.firedBar } };
}

/**
 * TradingView conditions, pure. Events compare this check's side with the previous check's (the
 * first check only records); states fire whenever they hold, the first check included. `bar`
 * fires at most once per daily bar; `once` is switched off by the caller after it fires.
 */
export function decideCondition(c: AlertCondition, trigger: AlertTrigger, row: StateRow | undefined, seen: number | null, t: number | null): Decision {
  if (seen === null) return { fire: false, next: null };
  const firedThisBar = trigger === "bar" && row?.firedBar === t;
  const fire = !firedThisBar && (ALERT_CONDS[c.cond].kind === "event" ? row !== undefined && crossed(c.cond, row.state, seen) : seen === 1);
  return { fire, next: { state: seen, firedBar: fire ? t : (row?.firedBar ?? null) } };
}

interface Check {
  rule: string;
  key: string;
  text: string;
  tf: Timeframe;
  /** Set for `once` alerts, which are switched off after they fire */
  once: boolean;
  /** Off: a firing is recorded for the overview but not pushed */
  notify: boolean;
  decide: (row: StateRow | undefined) => Decision;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const log = (msg: string) => console.log(`[hebi8m] ${msg}`);

/** Which alerts a run judges: all of them after a daily sync, the ones on a symbol in a quote round, the whole-watchlist ones after one is saved. */
export type AlertPass = "sync" | "quotes" | "watchlist";

/** The symbols an alert covers: its own, or every watched one. */
export const alertKeys = (alert: AlertDef, cfg: Config): string[] => (alert.key ? [alert.key] : allItems(cfg).map((i) => i.key));

/** Every (alert, symbol) pair to judge in this pass, on the bars `read` gives. */
function checks(cfg: Config, pass: AlertPass, read: DailyReader | undefined, who: string): Check[] {
  const out: Check[] = [];
  // formulas on the same symbol and timeframe share the loaded series
  const caches = new Map<string, SeriesCache>();
  for (const alert of cfg.alerts) {
    if (!alert.enabled || (alert.key ? pass === "watchlist" : pass === "quotes")) continue;
    // on the whole watchlist one line per alert, not per symbol (`bench` on a symbol without one is common)
    const failed: { key: string; error: string }[] = [];
    const fail = (key: string, error: string) => (alert.key ? log(`alert ${alert.id} on ${key}${who}: ${error}`) : failed.push({ key, error }));
    for (const key of alertKeys(alert, cfg)) {
      const base = { rule: alert.id, key, text: alert.text, tf: alert.tf, once: alert.trigger === "once", notify: alert.notify };
      if (alert.when) {
        const cache = caches.get(key) ?? new Map();
        caches.set(key, cache);
        const result = evalRule(key, alert.when, alert.tf, cfg, cache, read);
        if (result.error) fail(key, result.error);
        out.push({ ...base, decide: (row) => decide(row, result) });
        continue;
      }
      const condition = alert.condition!;
      let bars;
      try {
        bars = loadDaily(key, cfg.prices, cfg, read);
      } catch (err) {
        fail(key, message(err));
        continue;
      }
      const seen = observe(condition, bars);
      const t = bars.at(-1)?.t ?? null;
      out.push({ ...base, decide: (row) => decideCondition(condition, alert.trigger, row, seen, t) });
    }
    if (failed.length) log(`alert ${alert.id} failed on ${failed.length} watched symbol(s)${who}, ${failed[0].key}: ${failed[0].error}`);
  }
  return out;
}

export const stateId = (rule: string, key: string) => `${rule}\u0000${key}`;

/** Every (alert, symbol) row of a vault, by `stateId`. */
export function readState(vault: string): Map<string, StateRow> {
  const rows = getDb().prepare("SELECT rule, key, state, fired_bar, fired_at FROM alert_state WHERE vault = ?").all(vault) as {
    rule: string;
    key: string;
    state: number | null;
    fired_bar: number | null;
    fired_at: number | null;
  }[];
  return new Map(rows.map((r) => [stateId(r.rule, r.key), { state: r.state ?? 0, firedBar: r.fired_bar, firedAt: r.fired_at }]));
}

/** Rows of an alert that left the yaml, or of a symbol it no longer covers, start over (old `cond:` rows included). */
function writeState(vault: string, updates: { rule: string; key: string; row: StateRow; fired: boolean }[], keep: Set<string>): void {
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO alert_state (vault, rule, key, state, fired_bar, fired_at) VALUES (@vault, @rule, @key, @state, @firedBar, @firedAt)
     ON CONFLICT (vault, rule, key) DO UPDATE SET state = @state, fired_bar = @firedBar, fired_at = coalesce(@firedAt, fired_at)`,
  );
  const all = db.prepare("SELECT rule, key FROM alert_state WHERE vault = ?").all(vault) as { rule: string; key: string }[];
  const remove = db.prepare("DELETE FROM alert_state WHERE vault = ? AND rule = ? AND key = ?");
  db.transaction(() => {
    for (const u of updates) {
      upsert.run({ vault, rule: u.rule, key: u.key, state: u.row.state, firedBar: u.row.firedBar, firedAt: u.fired ? Date.now() : null });
    }
    for (const r of all) if (!keep.has(stateId(r.rule, r.key))) remove.run(vault, r.rule, r.key);
  })();
}

/** When each of a vault's alerts last fired (ms), by alert id. */
export function alertFiredAt(vault: string): Map<string, number> {
  const rows = getDb().prepare("SELECT rule, fired_at FROM alert_state WHERE vault = ? AND rule LIKE 'alert:%' AND fired_at IS NOT NULL").all(vault) as { rule: string; fired_at: number }[];
  return new Map(rows.map((r) => [r.rule, r.fired_at]));
}

/** An edited or resumed alert starts over: events record their side again, nothing counts as fired. */
export function forgetAlerts(vault: string, ids: string[]): void {
  const remove = getDb().prepare("DELETE FROM alert_state WHERE vault = ? AND rule = ?");
  for (const alertId of ids) remove.run(vault, alertId);
}

/** Where an alert sits in the yaml's `alerts` list, found by the id it parses to; -1 when gone. */
export function alertIndex(doc: Document, alertId: string, aliases: Record<string, string>): number {
  const seq = doc.get("alerts");
  if (!isSeq(seq)) return -1;
  return seq.items.findIndex((item, i) => {
    try {
      return parseAlert(isMap(item) ? item.toJSON() : item, i, aliases).id === alertId;
    } catch {
      return false;
    }
  });
}

/**
 * The migration of the old `conditions` list: each entry moves to the end of `alerts` as the alert
 * on the whole watchlist it is read as (same id, so the same state), and `conditions` goes.
 */
function adoptConditions(doc: Document, alerts: YAMLSeq): void {
  const conditions = doc.get("conditions");
  for (const item of isSeq(conditions) ? conditions.items : []) {
    const { id, label, when, tf, notify } = conditionAsAlert(isMap(item) ? item.toJSON() : item);
    alerts.add(doc.createNode({ ...(id ? { id } : {}), label, when, tf, ...(notify ? {} : { notify: false }) }, { flow: true }));
  }
  doc.delete("conditions");
}

/** Every UI edit of the alerts goes through here, so the old conditions become editable alerts first. */
export function editAlerts(dir: string, mutate: (doc: Document, alerts: YAMLSeq) => void): Config {
  return updateConfig(dir, (doc) => {
    let alerts = doc.get("alerts");
    if (!isSeq(alerts)) {
      alerts = doc.createNode([]);
      doc.set("alerts", alerts);
    }
    const seq = alerts as YAMLSeq;
    // `alerts: []` from the example becomes a block list once it has entries
    seq.flow = false;
    if (doc.has("conditions")) adoptConditions(doc, seq);
    mutate(doc, seq);
  });
}

/** Switch alerts on or off in a vault's yaml, keeping comments. */
export function setAlertsEnabled(dir: string, ids: string[], enabled: boolean): void {
  const aliases = readConfig(dir).aliases;
  editAlerts(dir, (doc) => {
    for (const alertId of ids) {
      const i = alertIndex(doc, alertId, aliases);
      if (i < 0) continue;
      // `enabled: true` is the default, so switching back on just drops the key
      if (enabled) doc.deleteIn(["alerts", i, "enabled"]);
      else doc.setIn(["alerts", i, "enabled"], false);
    }
  });
}

/** A daily sync and a quote round may end together; one vault's state is read and written by one run at a time. */
let queue: Promise<unknown> = Promise.resolve();

/** Alert edits and judging share the same queue, including delivery and its committed state. */
export function serializeAlerts<T>(run: () => T | Promise<T>): Promise<T> {
  const job = queue.then(run);
  queue = job.catch(() => undefined);
  return job;
}

/**
 * Judge one vault and deliver its events as one digest. `read` gives the bars (a quote round's live
 * ones; the daily ones by default). The config is loaded when the run starts, not when it is
 * queued, so a `once` alert switched off (or an alert paused) by the run before is seen as off.
 * Never throws; returns the events.
 */
export function runAlerts(vault: VaultRef, loadConfig: () => Config, pass: AlertPass = "sync", read?: DailyReader): Promise<AlertEvent[]> {
  return serializeAlerts(() => judge(vault, loadConfig, pass, read));
}

async function judge(vault: VaultRef, loadConfig: () => Config, pass: AlertPass, read: DailyReader | undefined): Promise<AlertEvent[]> {
  const who = vault.id ? ` (${vault.id})` : "";
  try {
    const cfg = loadConfig();
    const list = checks(cfg, pass, read, who);
    const state = readState(vault.id);
    const symbols = listSymbols();
    const updates: { rule: string; key: string; row: StateRow; fired: boolean; notify: boolean }[] = [];
    const events: AlertEvent[] = [];
    const switchOff: { rule: string; notify: boolean }[] = [];
    const retryOff: string[] = [];
    for (const c of list) {
      const row = state.get(stateId(c.rule, c.key));
      // Delivery already committed: retry the failed yaml switch-off without sending again.
      if (c.once && row?.firedAt != null) {
        retryOff.push(c.rule);
        continue;
      }
      const { fire, next } = c.decide(row);
      if (next) updates.push({ rule: c.rule, key: c.key, row: next, fired: fire, notify: c.notify });
      if (!fire) continue;
      if (c.once) switchOff.push({ rule: c.rule, notify: c.notify });
      if (!c.notify) continue;
      let close: number | null = null;
      try {
        close = loadDaily(c.key, cfg.prices, cfg, read ?? readDaily).at(-1)?.c ?? null;
      } catch {
        // the name and label are enough
      }
      events.push({ rule: c.rule, key: c.key, name: nameOf(cfg, c.key, symbols[c.key]?.name), label: c.text, tf: c.tf, close });
    }
    // every row an alert in the yaml covers stays, so a switched-off alert can tell 已触发 from 已停止
    const keep = new Set(cfg.alerts.flatMap((a) => alertKeys(a, cfg).map((key) => stateId(a.id, key))));
    const commit = (delivered: boolean) => {
      // nothing got through: leave the pushed rows (and their `once` alerts) as they were so the next check tries again
      writeState(vault.id, delivered ? updates : updates.filter((u) => !(u.fired && u.notify)), keep);
      const stopped = [...retryOff, ...switchOff.filter((s) => delivered || !s.notify).map((s) => s.rule)];
      if (stopped.length === 0) return;
      try {
        setAlertsEnabled(vault.dir, stopped, false);
      } catch (err) {
        log(`could not switch off fired alerts${who}: ${message(err)}`);
      }
    };

    if (events.length === 0) {
      commit(true);
      return [];
    }
    const { config, error } = channelsFor(vault.id, cfg.owner);
    if (error) log(`notify.json: ${error}`);
    const { title, text } = formatDigest(events, config.link);
    log(`${events.length} new alert(s)${who}: ${events.map((e) => `${e.key} ${e.rule}`).join(", ")}`);
    if (channelNames(config).length === 0) {
      log(`no notification channel configured${who}, alerts only logged`);
      commit(true);
      return events;
    }
    const delivery = await deliver(config, title, text, events);
    for (const f of delivery.failed) log(`notify via ${f.channel}${who} failed: ${f.error}`);
    commit(delivery.sent.length > 0);
    return events;
  } catch (err) {
    log(`alerts${who} failed: ${message(err)}`);
    return [];
  }
}
