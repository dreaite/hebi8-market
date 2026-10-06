/** Typed view of `vault/hebi8.yaml`; pure so it can be tested without a file system. */
import { compile } from "@/indicators/formula";
import { CHANGE_PERIODS, DEFAULT_PERIODS, MAX_PERIODS, type ChangePeriod } from "./periods";
import type { Prices } from "./series";
import { DATA_ID, hash6, isSynthetic, isTimeframe, isValidKey, type Timeframe } from "./symbols";
import { parseSynth } from "./synth";

export type UpDown = "green-up" | "red-up";
export type ChartStyle = "candle_solid" | "candle_up_stroke" | "ohlc" | "area";
export const CHART_STYLES: Record<ChartStyle, string> = {
  candle_solid: "实心 K 线",
  candle_up_stroke: "空心阳线",
  ohlc: "美国线",
  area: "面积",
};

export interface WatchItem {
  key: string;
  /** Display name from the yaml; null falls back to what the source reports */
  name: string | null;
  bench: string | null;
  group: string;
}

export interface Group {
  name: string;
  symbols: WatchItem[];
}

export interface FormulaDef {
  id: string;
  label: string;
  pane: "main" | "sub";
  formula: string;
}

export interface ConditionDef {
  id: string;
  label: string;
  formula: string;
  tf: Timeframe;
  /** Push a message after a sync when this condition newly holds for a watched symbol */
  notify: boolean;
}

/** A rule on one symbol, pushed after a sync when it newly holds. */
export interface AlertDef {
  /** `alert:<id>` when given in the yaml, else a hash of key, formula and timeframe */
  id: string;
  key: string;
  label: string;
  when: string;
  tf: Timeframe;
}

export type ParamOverrides = Partial<Record<Timeframe, Record<string, number[]>>>;

export interface ChartPrefs {
  tf: Timeframe;
  log: boolean;
  style: ChartStyle;
  /** Enabled indicator names: built-in, custom, or formula ids */
  indicators: string[];
  params: ParamOverrides;
}

export interface Config {
  sync: { at: string[]; tz: string };
  prices: Prices;
  periods: ChangePeriod[];
  updown: UpDown;
  aliases: Record<string, string>;
  groups: Group[];
  indicators: FormulaDef[];
  conditions: ConditionDef[];
  alerts: AlertDef[];
  /** Dataset name → git URL or local directory (absolute, `~/`, or relative to the vault) */
  datasets: Record<string, string>;
  chart: ChartPrefs;
}

export class ConfigError extends Error {}

export const DEFAULT_CHART: ChartPrefs = { tf: "W", log: true, style: "candle_solid", indicators: ["MA", "VOL"], params: {} };

const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Aliases first, otherwise the reference is taken as a full key. */
export function resolveKey(ref: string, aliases: Record<string, string>): string {
  const r = ref.trim();
  return aliases[r] ?? r;
}

function checkKey(key: string, aliases: Record<string, string>, where: string): void {
  if (!isValidKey(key)) throw new ConfigError(`${where}：无效的 key「${key}」，应为 source:ticker 或 =表达式`);
  if (isSynthetic(key)) {
    try {
      parseSynth(key.slice(1), aliases);
    } catch (err) {
      throw new ConfigError(`${where}：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function parseGroups(raw: unknown, aliases: Record<string, string>): Group[] {
  const seen = new Map<string, string>();
  return list(raw).map((g, gi) => {
    const group = obj(g);
    const name = text(group.name) ?? `组 ${gi + 1}`;
    const symbols = list(group.symbols).map((s, si) => {
      const where = `groups[${gi}].symbols[${si}]`;
      const entry = typeof s === "string" ? { key: s } : obj(s);
      const ref = text(entry.key);
      if (!ref) throw new ConfigError(`${where}：缺少 key`);
      const key = resolveKey(ref, aliases);
      checkKey(key, aliases, where);
      const benchRef = text(entry.bench);
      const bench = benchRef ? resolveKey(benchRef, aliases) : null;
      if (bench) checkKey(bench, aliases, `${where}.bench`);
      const owner = seen.get(key);
      if (owner) throw new ConfigError(`${where}：${key} 已经在「${owner}」组里，一个标的只能出现在一个组`);
      seen.set(key, name);
      return { key, name: text(entry.name), bench, group: name };
    });
    return { name, symbols };
  });
}

function parseParams(raw: unknown): ParamOverrides {
  const out: ParamOverrides = {};
  for (const [tf, byName] of Object.entries(obj(raw))) {
    if (!isTimeframe(tf)) continue;
    const params: Record<string, number[]> = {};
    for (const [name, values] of Object.entries(obj(byName))) {
      const nums = list(values).map(Number).filter((n) => Number.isFinite(n) && n > 0);
      if (nums.length) params[name] = nums;
    }
    out[tf] = params;
  }
  return out;
}

export function normalizeConfig(raw: unknown): Config {
  const root = obj(raw);

  const sync = obj(root.sync);
  const at = list(sync.at)
    .map(String)
    .filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  const tz = text(sync.tz) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
  } catch {
    throw new ConfigError(`sync.tz：无效的时区「${tz}」`);
  }

  const prices = root.prices ?? "split";
  if (prices !== "split" && prices !== "total") throw new ConfigError("prices 应为 split 或 total");

  const valid = new Set<string>(CHANGE_PERIODS.map((p) => p.key));
  const periods = list(root.periods)
    .map(String)
    .filter((p): p is ChangePeriod => valid.has(p))
    .slice(0, MAX_PERIODS);

  const updown = root.updown ?? "green-up";
  if (updown !== "green-up" && updown !== "red-up") throw new ConfigError("updown 应为 green-up 或 red-up");

  const aliases: Record<string, string> = {};
  for (const [name, value] of Object.entries(obj(root.aliases))) {
    const key = text(value);
    if (!key) continue;
    if (!isValidKey(key)) throw new ConfigError(`aliases.${name}：无效的 key「${key}」`);
    aliases[name] = key;
  }

  const indicators = list(root.indicators).flatMap((raw, i) => {
    const d = obj(raw);
    const id = text(d.id);
    const formula = text(d.formula);
    if (!id || !formula) throw new ConfigError(`indicators[${i}]：需要 id 和 formula`);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new ConfigError(`indicators[${i}]：id「${id}」只能用字母、数字、下划线`);
    return [{ id, label: text(d.label) ?? id, pane: d.pane === "main" ? ("main" as const) : ("sub" as const), formula }];
  });

  const conditions = list(root.conditions).flatMap((raw, i) => {
    const d = obj(raw);
    const id = text(d.id);
    const formula = text(d.formula);
    if (!id || !formula) throw new ConfigError(`conditions[${i}]：需要 id 和 formula`);
    return [{ id, label: text(d.label) ?? id, formula, tf: isTimeframe(d.tf) ? d.tf : ("W" as const), notify: d.notify === true }];
  });

  const alerts = list(root.alerts).map((raw, i): AlertDef => {
    const d = obj(raw);
    const where = `alerts[${i}]`;
    const ref = text(d.key);
    const when = text(d.when);
    if (!ref || !when) throw new ConfigError(`${where}：需要 key 和 when`);
    const key = resolveKey(ref, aliases);
    checkKey(key, aliases, `${where}.key`);
    const tf = isTimeframe(d.tf) ? d.tf : ("D" as const);
    const own = text(d.id);
    if (own && !/^[A-Za-z0-9_-]+$/.test(own)) throw new ConfigError(`${where}：id「${own}」只能用字母、数字、下划线、横线`);
    return { id: `alert:${own ?? hash6(`${key}|${when}|${tf}`)}`, key, label: text(d.label) ?? when, when, tf };
  });
  const ids = new Set<string>();
  for (const a of alerts) {
    if (ids.has(a.id)) throw new ConfigError(`alerts：重复的规则「${a.id.slice(6)}」，同一标的同一公式只写一次，或给每条写不同的 id`);
    ids.add(a.id);
  }

  const datasets: Record<string, string> = {};
  for (const [name, value] of Object.entries(obj(root.datasets))) {
    const where = `datasets.${name}`;
    if (!DATA_ID.test(name)) throw new ConfigError(`${where}：名字只能用字母、数字、点、下划线、横线，并以字母或数字开头`);
    const location = text(value);
    if (!location) throw new ConfigError(`${where}：需要 git 地址或本机目录`);
    if (!isDatasetLocation(location)) throw new ConfigError(`${where}：「${location}」应为 https:// / ssh:// / git@ / file:// 地址，或以 / ~/ ./ ../ 开头的目录`);
    datasets[name] = location;
  }

  const chart = obj(root.chart);
  const style = chart.style ?? DEFAULT_CHART.style;
  if (typeof style !== "string" || !(style in CHART_STYLES)) throw new ConfigError(`chart.style：未知样式「${String(style)}」`);

  return {
    sync: { at: at.length ? at : ["07:30", "17:30"], tz },
    prices,
    periods: periods.length ? periods : DEFAULT_PERIODS,
    updown,
    aliases,
    groups: parseGroups(root.groups, aliases),
    indicators,
    conditions,
    alerts,
    datasets,
    chart: {
      tf: isTimeframe(chart.tf) ? chart.tf : DEFAULT_CHART.tf,
      log: typeof chart.log === "boolean" ? chart.log : DEFAULT_CHART.log,
      style: style as ChartStyle,
      indicators: Array.isArray(chart.indicators) ? chart.indicators.map(String) : DEFAULT_CHART.indicators,
      params: parseParams(chart.params),
    },
  };
}

/** Remote repos are cloned into the cache; anything path-like is read in place. */
export const isRemoteDataset = (location: string) => /^(https:\/\/|ssh:\/\/|file:\/\/|git@[^:]+:)/.test(location);
const isDatasetLocation = (location: string) => isRemoteDataset(location) || /^(\/|~\/|\.\.?\/)/.test(location);

export function allItems(cfg: Config): WatchItem[] {
  return cfg.groups.flatMap((g) => g.symbols);
}

export function findItem(cfg: Config, key: string): WatchItem | null {
  return allItems(cfg).find((s) => s.key === key) ?? null;
}

/** Every real key that needs syncing: watched symbols, benchmarks, formula references, synthetic operands. */
export function syncKeys(cfg: Config, extra: string[] = []): string[] {
  const keys = new Set<string>();
  const add = (key: string) => {
    if (!isValidKey(key)) return;
    if (!isSynthetic(key)) {
      keys.add(key);
      return;
    }
    try {
      parseSynth(key.slice(1), cfg.aliases).keys.forEach(add);
    } catch {
      // reported on the page, not here
    }
  };
  for (const item of allItems(cfg)) {
    add(item.key);
    if (item.bench) add(item.bench);
  }
  for (const formula of [...cfg.indicators, ...cfg.conditions].map((d) => d.formula).concat(cfg.alerts.map((a) => a.when))) {
    try {
      compile(formula, { aliases: cfg.aliases }).refs.forEach(add);
    } catch {
      // bad formulas are shown where they are used
    }
  }
  for (const alert of cfg.alerts) {
    add(alert.key);
    const bench = findItem(cfg, alert.key)?.bench;
    if (bench) add(bench);
  }
  extra.forEach(add);
  return [...keys];
}
