"use server";

import { revalidatePath } from "next/cache";
import { isMap, isScalar, isSeq, type Document, type YAMLMap, type YAMLSeq } from "yaml";
import { compile } from "@/indicators/formula";
import { describeError } from "@/indicators/formula-indicators";
import { CHART_STYLES, findItem, resolveKey, type ChartPrefs, type ConditionDef, type FormulaDef } from "@/lib/config";
import { CHANGE_PERIODS, MAX_PERIODS } from "@/lib/periods";
import type { Prices } from "@/lib/series";
import { getSymbol } from "@/lib/store";
import { wellKnownName } from "@/lib/wellknown";
import { isCJK } from "@/lib/search";
import { isSynthetic, isTimeframe, isValidKey } from "@/lib/symbols";
import { parseSynth } from "@/lib/synth";
import { recomputeStats, syncAll, syncOne } from "@/lib/sync";
import {
  flowNode,
  readConfig,
  setList,
  setScalar,
  updateConfig,
  writeChartState,
  writeJournal,
  writeNote,
  type ChartState,
} from "@/lib/vault";
import { isWeekId } from "@/lib/week";

export type ActionResult = { ok: true } | { ok: false; error: string };

async function attempt(fn: () => Promise<void> | void): Promise<ActionResult> {
  try {
    await fn();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function seqOf(parent: YAMLMap, name: string, doc: Document): YAMLSeq {
  const existing = parent.get(name);
  if (isSeq(existing)) return existing;
  const seq = doc.createNode([]) as YAMLSeq;
  parent.set(name, seq);
  return seq;
}

function entryKey(item: unknown, aliases: Record<string, string>): string | null {
  const value = isMap(item) ? item.get("key") : isScalar(item) ? item.value : item;
  return typeof value === "string" ? resolveKey(value, aliases) : null;
}

/** Where a watched key lives in the document: its group's `symbols` list and the index in it. */
function locateEntry(doc: Document, key: string, aliases: Record<string, string>): { symbols: YAMLSeq; index: number } | null {
  const groups = doc.get("groups");
  if (!isSeq(groups)) return null;
  for (const group of groups.items) {
    if (!isMap(group)) continue;
    const symbols = group.get("symbols");
    if (!isSeq(symbols)) continue;
    const index = symbols.items.findIndex((item) => entryKey(item, aliases) === key);
    if (index >= 0) return { symbols, index };
  }
  return null;
}

/** A plain `- SPY` entry becomes `{ key: SPY }` so fields can be attached without losing the alias. */
function entryAsMap(doc: Document, symbols: YAMLSeq, index: number): YAMLMap {
  const item = symbols.items[index];
  if (isMap(item)) return item;
  const ref = isScalar(item) ? String(item.value) : String(item);
  const node = flowNode(doc, { key: ref }) as YAMLMap;
  symbols.items[index] = node;
  return node;
}

function groupNode(doc: Document, name: string): YAMLMap {
  const groups = seqOf(doc.contents as YAMLMap, "groups", doc);
  let node = groups.items.find((g) => isMap(g) && g.get("name") === name) as YAMLMap | undefined;
  if (!node) {
    node = doc.createNode({ name, symbols: [] }) as YAMLMap;
    groups.add(node);
  }
  return node;
}

export async function refresh(): Promise<ActionResult> {
  return attempt(async () => {
    await syncAll(true);
  });
}

export interface AddSymbolInput {
  key: string;
  group: string;
  name?: string;
  bench?: string;
  /** The search text that led here (e.g.「腾讯」); remembered as an alias for the key */
  alias?: string;
}

export async function addSymbol(input: AddSymbolInput): Promise<ActionResult> {
  return attempt(async () => {
    const cfg = readConfig();
    const ref = str(input.key);
    const key = resolveKey(ref, cfg.aliases);
    const group = str(input.group);
    if (!isValidKey(key)) throw new Error(`无效的 key「${key}」，应为 source:ticker 或 =表达式`);
    if (!group) throw new Error("请选择分组");
    const existing = findItem(cfg, key);
    if (existing) throw new Error(`${key} 已经在「${existing.group}」组里`);
    const benchRef = str(input.bench);
    const bench = benchRef ? resolveKey(benchRef, cfg.aliases) : null;
    if (bench && !isValidKey(bench)) throw new Error(`无效的基准「${bench}」`);

    // The first fetch doubles as validation; nothing is written unless it succeeds.
    if (isSynthetic(key)) {
      for (const k of parseSynth(key.slice(1), cfg.aliases).keys) {
        const outcome = await syncOne(k);
        if (!outcome.ok) throw new Error(`拉取 ${k} 失败：${outcome.error}`);
      }
    } else {
      const outcome = await syncOne(key);
      if (!outcome.ok) throw new Error(`拉取 ${key} 失败：${outcome.error}`);
    }
    if (bench) await syncOne(bench);

    const name = str(input.name) || wellKnownName(key) || "";
    // a Chinese search term that found this key is worth keeping as an alias
    const alias = str(input.alias);
    const keepAlias = alias && isCJK(alias) && !alias.includes(":") && !cfg.aliases[alias] && alias !== name;
    updateConfig((doc) => {
      const symbols = seqOf(groupNode(doc, group), "symbols", doc);
      const entry: Record<string, string> = { key: ref };
      if (name) entry.name = name;
      if (benchRef) entry.bench = benchRef;
      symbols.add(name || benchRef ? flowNode(doc, entry) : doc.createNode(ref));
      if (keepAlias) {
        const aliases = doc.get("aliases");
        if (isMap(aliases)) aliases.set(alias, key);
        else doc.set("aliases", doc.createNode({ [alias]: key }));
      }
    });
    recomputeStats(readConfig());
  });
}

export async function moveSymbol(key: string, group: string): Promise<ActionResult> {
  return attempt(() => {
    const target = str(group);
    if (!target) throw new Error("请选择分组");
    updateConfig((doc) => {
      const found = locateEntry(doc, key, readConfig().aliases);
      if (!found) throw new Error(`${key} 不在自选里`);
      const [item] = found.symbols.items.splice(found.index, 1);
      seqOf(groupNode(doc, target), "symbols", doc).add(item);
    });
  });
}

export async function renameSymbol(key: string, name: string): Promise<ActionResult> {
  return attempt(() => {
    const next = str(name);
    updateConfig((doc) => {
      const found = locateEntry(doc, key, readConfig().aliases);
      if (!found) throw new Error(`${key} 不在自选里`);
      const entry = entryAsMap(doc, found.symbols, found.index);
      if (next) entry.set("name", next);
      else entry.delete("name");
    });
  });
}

export async function setBench(key: string, bench: string | null): Promise<ActionResult> {
  return attempt(async () => {
    const cfg = readConfig();
    const benchRef = str(bench);
    const target = benchRef ? resolveKey(benchRef, cfg.aliases) : null;
    if (target) {
      if (!isValidKey(target)) throw new Error(`无效的基准「${benchRef}」`);
      if (target === key) throw new Error("基准不能是自己");
      if (!isSynthetic(target)) {
        const outcome = await syncOne(target);
        if (!outcome.ok) throw new Error(`拉取 ${target} 失败：${outcome.error}`);
      }
    }
    updateConfig((doc) => {
      const found = locateEntry(doc, key, cfg.aliases);
      if (!found) throw new Error(`${key} 不在自选里`);
      const entry = entryAsMap(doc, found.symbols, found.index);
      if (benchRef) entry.set("bench", benchRef);
      else entry.delete("bench");
    });
    recomputeStats(readConfig());
  });
}

export async function removeSymbol(key: string): Promise<ActionResult> {
  return attempt(() => {
    updateConfig((doc) => {
      const found = locateEntry(doc, key, readConfig().aliases);
      if (found) found.symbols.delete(found.index);
    });
  });
}

export async function saveNote(key: string, body: string): Promise<ActionResult> {
  return attempt(() => {
    if (!isValidKey(key)) throw new Error("无效的 key");
    writeNote(key, String(body ?? ""));
  });
}

export async function saveJournal(week: string, body: string): Promise<ActionResult> {
  return attempt(() => {
    if (!isWeekId(week)) throw new Error("无效的周");
    writeJournal(week, String(body ?? ""));
  });
}

function checkFormula(def: { id: unknown; label: unknown; formula: unknown }): { id: string; label: string; formula: string } {
  const id = str(def.id);
  const label = str(def.label) || id;
  const formula = str(def.formula);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) throw new Error("id 只能用字母、数字、下划线");
  if (!formula) throw new Error("公式为空");
  try {
    compile(formula, { aliases: readConfig().aliases });
  } catch (err) {
    throw new Error(describeError(err));
  }
  return { id, label, formula };
}

/** Insert or replace a `{ id, … }` entry in a top-level list, keeping the others untouched. */
function upsertById(listName: string, entry: Record<string, unknown>) {
  updateConfig((doc) => {
    const seq = seqOf(doc.contents as YAMLMap, listName, doc);
    const index = seq.items.findIndex((item) => isMap(item) && item.get("id") === entry.id);
    const node = flowNode(doc, entry);
    if (index >= 0) seq.items[index] = node;
    else seq.add(node);
  });
}

function deleteById(listName: string, id: string) {
  updateConfig((doc) => {
    const seq = doc.get(listName);
    if (!isSeq(seq)) return;
    const index = seq.items.findIndex((item) => isMap(item) && item.get("id") === id);
    if (index >= 0) seq.delete(index);
    const enabled = doc.getIn(["chart", "indicators"]);
    if (isSeq(enabled)) {
      const i = enabled.items.findIndex((item) => (isScalar(item) ? item.value : item) === id);
      if (i >= 0) enabled.delete(i);
    }
  });
}

export async function saveIndicator(def: FormulaDef): Promise<ActionResult> {
  return attempt(() => {
    const { id, label, formula } = checkFormula(def);
    const pane = def.pane === "main" ? "main" : "sub";
    const isNew = !readConfig().indicators.some((d) => d.id === id);
    upsertById("indicators", { id, label, pane, formula });
    if (isNew) {
      updateConfig((doc) => {
        const enabled = readConfig().chart.indicators;
        if (!enabled.includes(id)) setList(doc, ["chart", "indicators"], [...enabled, id]);
      });
    }
  });
}

export async function deleteIndicator(id: string): Promise<ActionResult> {
  return attempt(() => deleteById("indicators", str(id)));
}

export async function saveCondition(def: Omit<ConditionDef, "notify"> & { notify?: boolean }): Promise<ActionResult> {
  return attempt(() => {
    const { id, label, formula } = checkFormula(def);
    const entry: Record<string, unknown> = { id, label, formula };
    if (isTimeframe(def.tf) && def.tf !== "W") entry.tf = def.tf;
    // an editor that does not know about notify keeps whatever the yaml says
    const notify = typeof def.notify === "boolean" ? def.notify : readConfig().conditions.find((c) => c.id === id)?.notify;
    if (notify) entry.notify = true;
    upsertById("conditions", entry);
    recomputeStats(readConfig());
  });
}

export async function deleteCondition(id: string): Promise<ActionResult> {
  return attempt(() => {
    deleteById("conditions", str(id));
    recomputeStats(readConfig());
  });
}

export async function saveChartState(key: string, state: ChartState): Promise<ActionResult> {
  return attempt(async () => {
    if (!isValidKey(key)) throw new Error("无效的 key");
    const cfg = readConfig();
    const compare = (Array.isArray(state.compare) ? state.compare : []).flatMap((c) => {
      const target = resolveKey(str(c.key), cfg.aliases);
      if (!isValidKey(target) || target === key) return [];
      return [{ key: target, mode: c.mode === "pane" ? ("pane" as const) : ("percent" as const), color: str(c.color) || "#e8891d" }];
    });
    const overlays = (Array.isArray(state.overlays) ? state.overlays : []).flatMap((o) => {
      if (typeof o?.name !== "string" || !Array.isArray(o.points)) return [];
      const points = o.points.filter((p) => Number.isFinite(p?.timestamp) && Number.isFinite(p?.value)).map((p) => ({ timestamp: p.timestamp, value: p.value }));
      return [{ name: o.name, points, ...(o.styles ? { styles: o.styles } : {}), ...(o.lock ? { lock: true } : {}), ...(o.extendData !== undefined ? { extendData: o.extendData } : {}) }];
    });
    // compare targets must be in the cache before the chart asks for them
    for (const c of compare) {
      if (isSynthetic(c.key)) continue;
      if (!getSymbol(c.key)?.syncedAt) {
        const outcome = await syncOne(c.key, true);
        if (!outcome.ok) throw new Error(`拉取 ${c.key} 失败：${outcome.error}`);
      }
    }
    writeChartState(key, { compare, overlays });
  });
}

export async function setChartPrefs(partial: Partial<ChartPrefs> & { prices?: Prices }): Promise<ActionResult> {
  return attempt(() => {
    const cfg = readConfig();
    updateConfig((doc) => {
      if (partial.tf !== undefined) {
        if (!isTimeframe(partial.tf)) throw new Error("无效的周期");
        setScalar(doc, ["chart", "tf"], partial.tf);
      }
      if (partial.log !== undefined) setScalar(doc, ["chart", "log"], Boolean(partial.log));
      if (partial.style !== undefined) {
        if (!(partial.style in CHART_STYLES)) throw new Error("无效的样式");
        setScalar(doc, ["chart", "style"], partial.style);
      }
      if (partial.indicators !== undefined) setList(doc, ["chart", "indicators"], partial.indicators.map(String));
      if (partial.params !== undefined) {
        for (const [tf, byName] of Object.entries(partial.params)) {
          if (!isTimeframe(tf) || !byName) continue;
          for (const [name, values] of Object.entries(byName)) {
            const nums = (values ?? []).filter((n) => Number.isFinite(n) && n > 0);
            if (!nums.length) doc.deleteIn(["chart", "params", tf, name]);
            else if (doc.hasIn(["chart", "params", tf])) setList(doc, ["chart", "params", tf, name], nums);
            else doc.setIn(["chart", "params", tf], flowNode(doc, { [name]: nums }));
          }
        }
      }
      if (partial.prices !== undefined) {
        if (partial.prices !== "split" && partial.prices !== "total") throw new Error("无效的价格模式");
        setScalar(doc, ["prices"], partial.prices);
      }
    });
    if (partial.prices !== undefined && partial.prices !== cfg.prices) recomputeStats(readConfig());
  });
}

export async function setPeriods(list: string[]): Promise<ActionResult> {
  return attempt(() => {
    const valid = new Set<string>(CHANGE_PERIODS.map((p) => p.key));
    const periods = (Array.isArray(list) ? list : []).filter((p) => valid.has(p)).slice(0, MAX_PERIODS);
    if (!periods.length) throw new Error("至少选一个周期");
    updateConfig((doc) => setList(doc, ["periods"], periods));
  });
}

export async function setUpdown(mode: string): Promise<ActionResult> {
  return attempt(() => {
    if (mode !== "green-up" && mode !== "red-up") throw new Error("无效的涨跌色");
    updateConfig((doc) => setScalar(doc, ["updown"], mode));
  });
}
