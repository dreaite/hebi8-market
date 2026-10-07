/** What the chart's alert lines and alert list show (§5.2), read from the vault, the cache and the quotes table. No network. */
import type { AlertCond, AlertCondition, AlertTrigger } from "./alert-conds";
import { conditionLevels, describeCondition } from "./alert-conds";
import { alertFiredAt } from "./alerts";
import { loadDaily, type DailyReader } from "./bars";
import type { Config } from "./config";
import { nameOf } from "./names";
import { liveReader } from "./quotes";
import { getSymbol, readQuotes, type SymbolRow } from "./store";

export interface AlertView {
  id: string;
  key: string;
  /** Display name of the symbol */
  name: string;
  label: string;
  /** The condition and its levels (「大于 1」), or the formula; shown under the name whatever the name is */
  summary: string;
  /** The label as written, null when generated */
  ownLabel: string | null;
  cond: AlertCond | null;
  value: AlertCondition["value"] | null;
  when: string | null;
  trigger: AlertTrigger;
  enabled: boolean;
  /** 活动 / 已触发 (a `once` alert that fired) / 已停止 */
  status: "active" | "triggered" | "stopped";
  /** Price lines on the chart: enabled condition alerts with a level */
  levels: number[];
  /** Latest price (quote, else the last daily close) and when it was taken (ms) */
  price: number | null;
  priceAt: number | null;
}

/** The latest price of any key, synthetic ones included: today's live bar when a quote is newer than the daily sync. */
export function latestPrice(key: string, cfg: Config, read: DailyReader = liveReader()): { price: number | null; at: number | null } {
  let price: number | null = null;
  try {
    price = loadDaily(key, cfg.prices, cfg, read).at(-1)?.c ?? null;
  } catch {
    // a broken synthetic expression shows no price
  }
  const quote = readQuotes()[key];
  const meta = getSymbol(key);
  const at = quote && (!meta?.syncedAt || quote.fetchedAt > meta.syncedAt) ? quote.fetchedAt : (meta?.syncedAt ?? null);
  return { price, at };
}

export function alertViews(vault: string, cfg: Config, symbols: Record<string, SymbolRow>): AlertView[] {
  const fired = alertFiredAt(vault);
  const read = liveReader();
  return cfg.alerts.map((a) => {
    const { price, at } = latestPrice(a.key, cfg, read);
    return {
      id: a.id,
      key: a.key,
      name: nameOf(cfg, a.key, symbols[a.key]?.name),
      label: a.label,
      summary: a.condition ? describeCondition(a.condition) : `公式 ${a.when}`,
      ownLabel: a.ownLabel,
      cond: a.condition?.cond ?? null,
      value: a.condition?.value ?? null,
      when: a.when,
      trigger: a.trigger,
      enabled: a.enabled,
      status: a.enabled ? "active" : a.trigger === "once" && fired.has(a.id) ? "triggered" : "stopped",
      levels: a.enabled && a.condition ? conditionLevels(a.condition) : [],
      price,
      priceAt: at,
    };
  });
}
