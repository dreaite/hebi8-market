/**
 * Post-sync alerts: conditions marked `notify` (on every watched symbol) and `alerts` rules (on
 * one symbol each) are pushed when they newly hold. State lives in the `alert_state` table so a
 * restart does not repeat a message; a fresh cache records silently instead of replaying. Each
 * vault is judged and delivered on its own, with its own rows.
 */
import { loadDaily } from "./bars";
import { evalRule } from "./conditions";
import { allItems, type Config } from "./config";
import { getDb } from "./db";
import { nameOf } from "./names";
import { channelNames, channelsFor, deliver, formatDigest, type AlertEvent } from "./notify";
import type { ConditionResult } from "./stats";
import { listSymbols } from "./store";
import type { Timeframe } from "./symbols";

export interface StateRow {
  state: 0 | 1;
  firedBar: number | null;
}

/**
 * The transition rule, pure. Unknown results leave the row alone; the first sighting only
 * records; a rule fires when it turns true, at most once per bar (a weekly condition that
 * flickers inside the unfinished week fires once).
 */
export function decide(row: StateRow | undefined, result: Pick<ConditionResult, "now" | "t">): { fire: boolean; next: StateRow | null } {
  if (result.now === null) return { fire: false, next: null };
  const now = result.now;
  const t = result.t ?? null;
  if (!row) return { fire: false, next: { state: now ? 1 : 0, firedBar: now ? t : null } };
  if (now && row.state === 0 && row.firedBar !== t) return { fire: true, next: { state: 1, firedBar: t } };
  return { fire: false, next: { state: now ? 1 : 0, firedBar: row.firedBar } };
}

interface Check {
  rule: string;
  key: string;
  label: string;
  tf: Timeframe;
  result: ConditionResult;
}

/** Every (rule, symbol) pair to look at, reusing the condition results the stats pass computed. */
function checks(cfg: Config, conditions: Map<string, Record<string, ConditionResult>>): Check[] {
  const out: Check[] = [];
  const items = allItems(cfg);
  for (const cond of cfg.conditions) {
    if (!cond.notify) continue;
    for (const item of items) {
      const result = conditions.get(item.key)?.[cond.id] ?? evalRule(item.key, cond.formula, cond.tf, cfg);
      out.push({ rule: `cond:${cond.id}`, key: item.key, label: cond.label, tf: cond.tf, result });
    }
  }
  for (const alert of cfg.alerts) {
    out.push({ rule: alert.id, key: alert.key, label: alert.label, tf: alert.tf, result: evalRule(alert.key, alert.when, alert.tf, cfg) });
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
    // rules or symbols that left the yaml start over silently if they come back
    for (const r of all) if (!keep.has(id(r.rule, r.key))) remove.run(vault, r.rule, r.key);
  })();
}

const log = (msg: string) => console.log(`[hebi8] ${msg}`);

/** Run for each vault after `syncAll` has written its stats. Never throws; returns the events it found. */
export async function runAlerts(vault: string, cfg: Config, conditions: Map<string, Record<string, ConditionResult>>): Promise<AlertEvent[]> {
  const who = vault ? ` (${vault})` : "";
  try {
    const list = checks(cfg, conditions);
    if (list.length === 0) {
      writeState(vault, [], new Set());
      return [];
    }
    const state = readState(vault);
    const symbols = listSymbols();
    const updates: { rule: string; key: string; row: StateRow; fired: boolean }[] = [];
    const events: AlertEvent[] = [];
    for (const c of list) {
      if (c.result.error) log(`alert ${c.rule} on ${c.key}${who}: ${c.result.error}`);
      const { fire, next } = decide(state.get(id(c.rule, c.key)), c.result);
      if (next) updates.push({ rule: c.rule, key: c.key, row: next, fired: fire });
      if (!fire) continue;
      let close: number | null = null;
      try {
        close = loadDaily(c.key, cfg.prices, cfg).at(-1)?.c ?? null;
      } catch {
        // the name and label are enough
      }
      events.push({ rule: c.rule, key: c.key, name: nameOf(cfg, c.key, symbols[c.key]?.name), label: c.label, tf: c.tf, close });
    }
    const keep = new Set(list.map((c) => id(c.rule, c.key)));

    if (events.length === 0) {
      writeState(vault, updates, keep);
      return [];
    }

    const { config, error } = channelsFor(vault, cfg.owner);
    if (error) log(`notify.json: ${error}`);
    const { title, text } = formatDigest(events, config.link);
    log(`${events.length} new alert(s)${who}: ${events.map((e) => `${e.key} ${e.rule}`).join(", ")}`);
    if (channelNames(config).length === 0) {
      log(`no notification channel configured${who}, alerts only logged`);
      writeState(vault, updates, keep);
      return events;
    }
    const delivery = await deliver(config, title, text, events);
    for (const f of delivery.failed) log(`notify via ${f.channel}${who} failed: ${f.error}`);
    // nothing got through: leave the fired rows as they were so the next sync tries again
    writeState(vault, delivery.sent.length ? updates : updates.filter((u) => !u.fired), keep);
    return events;
  } catch (err) {
    log(`alerts${who} failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
