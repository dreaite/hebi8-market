/**
 * Alerts (§2.5, §2.6): conditions marked `notify` on every watched symbol, judged when a daily sync
 * ends, and the `alerts` list, judged then and after every 5-minute quote round on daily bars
 * whose last one is today's unfinished bar. State lives in the `alert_state` table, per vault, so
 * a restart does not repeat a message and event conditions compare with the previous check.
 */
import { isMap, isSeq, type Document } from "yaml";
import { crossed, observe, ALERT_CONDS, type AlertCondition, type AlertTrigger } from "./alert-conds";
import { loadDaily, type DailyReader } from "./bars";
import { evalRule } from "./conditions";
import { allItems, parseAlert, type Config } from "./config";
import { getDb } from "./db";
import { nameOf } from "./names";
import { channelNames, channelsFor, deliver, formatDigest, type AlertEvent } from "./notify";
import type { ConditionResult } from "./stats";
import { listSymbols, readDaily } from "./store";
import type { Timeframe } from "./symbols";
import { readConfig, updateConfig, type VaultRef } from "./vault";

export interface StateRow {
  state: 0 | 1;
  firedBar: number | null;
}

type Decision = { fire: boolean; next: StateRow | null };

/**
 * Formula rules (notify conditions and `when` alerts), pure. Unknown results leave the row alone;
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
export function decideCondition(c: AlertCondition, trigger: AlertTrigger, row: StateRow | undefined, seen: 0 | 1 | null, t: number | null): Decision {
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
  decide: (row: StateRow | undefined) => Decision;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const log = (msg: string) => console.log(`[hebi8m] ${msg}`);

/**
 * Every (rule, symbol) pair to judge. Notify conditions only at the end of a daily sync (reusing
 * the stats pass's results); enabled alerts every time, on the bars `read` gives.
 */
function checks(cfg: Config, conditions: Map<string, Record<string, ConditionResult>>, read: DailyReader | undefined, who: string): Check[] {
  const out: Check[] = [];
  if (!read) {
    const items = allItems(cfg);
    for (const cond of cfg.conditions) {
      if (!cond.notify) continue;
      for (const item of items) {
        const result = conditions.get(item.key)?.[cond.id] ?? evalRule(item.key, cond.formula, cond.tf, cfg);
        if (result.error) log(`condition ${cond.id} on ${item.key}${who}: ${result.error}`);
        out.push({ rule: `cond:${cond.id}`, key: item.key, text: cond.label, tf: cond.tf, once: false, decide: (row) => decide(row, result) });
      }
    }
  }
  for (const alert of cfg.alerts) {
    if (!alert.enabled) continue;
    const base = { rule: alert.id, key: alert.key, text: alert.text, tf: alert.tf, once: alert.trigger === "once" };
    if (alert.when) {
      const result = evalRule(alert.key, alert.when, alert.tf, cfg, new Map(), read);
      if (result.error) log(`alert ${alert.id} on ${alert.key}${who}: ${result.error}`);
      out.push({ ...base, decide: (row) => decide(row, result) });
      continue;
    }
    const condition = alert.condition!;
    let bars;
    try {
      bars = loadDaily(alert.key, cfg.prices, cfg, read);
    } catch (err) {
      log(`alert ${alert.id} on ${alert.key}${who}: ${message(err)}`);
      continue;
    }
    const seen = observe(condition, bars);
    const t = bars.at(-1)?.t ?? null;
    out.push({ ...base, decide: (row) => decideCondition(condition, alert.trigger, row, seen, t) });
  }
  return out;
}

const id = (rule: string, key: string) => `${rule}\u0000${key}`;

function readState(vault: string): Map<string, StateRow> {
  const rows = getDb().prepare("SELECT rule, key, state, fired_bar FROM alert_state WHERE vault = ?").all(vault) as {
    rule: string;
    key: string;
    state: number | null;
    fired_bar: number | null;
  }[];
  return new Map(rows.map((r) => [id(r.rule, r.key), { state: r.state ? 1 : 0, firedBar: r.fired_bar }]));
}

/** Rows whose rule left the yaml (or was switched off) start over; a quote round only prunes alert rows, it never sees the conditions. */
function writeState(vault: string, updates: { rule: string; key: string; row: StateRow; fired: boolean }[], keep: Set<string>, alertsOnly: boolean): void {
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
    for (const r of all) {
      if (keep.has(id(r.rule, r.key)) || (alertsOnly && !r.rule.startsWith("alert:"))) continue;
      remove.run(vault, r.rule, r.key);
    }
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

/** Switch alerts on or off in a vault's yaml, keeping comments. */
export function setAlertsEnabled(dir: string, ids: string[], enabled: boolean): void {
  const aliases = readConfig(dir).aliases;
  updateConfig(dir, (doc) => {
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

/**
 * Judge one vault and deliver its events as one digest. `read` makes it a quote round: alerts only,
 * on live bars. Never throws; returns the events it found.
 */
export function runAlerts(vault: VaultRef, cfg: Config, conditions: Map<string, Record<string, ConditionResult>>, read?: DailyReader): Promise<AlertEvent[]> {
  const job = queue.then(() => judge(vault, cfg, conditions, read));
  queue = job.catch(() => undefined);
  return job;
}

async function judge(vault: VaultRef, cfg: Config, conditions: Map<string, Record<string, ConditionResult>>, read: DailyReader | undefined): Promise<AlertEvent[]> {
  const who = vault.id ? ` (${vault.id})` : "";
  try {
    const list = checks(cfg, conditions, read, who);
    const state = readState(vault.id);
    const symbols = listSymbols();
    const updates: { rule: string; key: string; row: StateRow; fired: boolean }[] = [];
    const events: AlertEvent[] = [];
    const switchOff: string[] = [];
    for (const c of list) {
      const { fire, next } = c.decide(state.get(id(c.rule, c.key)));
      if (next) updates.push({ rule: c.rule, key: c.key, row: next, fired: fire });
      if (!fire) continue;
      if (c.once) switchOff.push(c.rule);
      let close: number | null = null;
      try {
        close = loadDaily(c.key, cfg.prices, cfg, read ?? readDaily).at(-1)?.c ?? null;
      } catch {
        // the name and label are enough
      }
      events.push({ rule: c.rule, key: c.key, name: nameOf(cfg, c.key, symbols[c.key]?.name), label: c.text, tf: c.tf, close });
    }
    // a switched-off alert keeps its row, so the list can tell 已触发 from 已停止
    const keep = new Set([...list.map((c) => id(c.rule, c.key)), ...cfg.alerts.map((a) => id(a.id, a.key))]);
    const commit = (delivered: boolean) => {
      // nothing got through: leave the fired rows (and `once` alerts) as they were so the next check tries again
      writeState(vault.id, delivered ? updates : updates.filter((u) => !u.fired), keep, Boolean(read));
      if (!delivered || switchOff.length === 0) return;
      try {
        setAlertsEnabled(vault.dir, switchOff, false);
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
