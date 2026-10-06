"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { deleteIndicator, saveChartState, saveIndicator, setChartPrefs } from "@/app/actions";
import { INDICATORS } from "@/indicators/catalog";
import { compileFormula, formulaIndicatorName, formulaTemplate } from "@/indicators/formula-indicators";
import type { BarsResponse, SearchHit } from "@/lib/api-types";
import { CHART_STYLES, resolveKey, type ChartPrefs, type ChartStyle, type FormulaDef, type ParamOverrides } from "@/lib/config";
import { changeColor, fmtAgo, fmtPct, fmtPrice } from "@/lib/format";
import type { Prices } from "@/lib/series";
import { isValidKey, SOURCE_LABELS, TF_LABELS, TIMEFRAMES, type Timeframe } from "@/lib/symbols";
import type { ChartState, CompareEntry, OverlaySpec } from "@/lib/vault";
import { IndicatorBar } from "./IndicatorBar";
import { COMPARE_COLORS, DRAW_TOOLS, type CompareLegendEntry, type IndicatorSpec } from "./KChart";
import { NotesPanel } from "./NotesPanel";

const KChart = dynamic(() => import("./KChart").then((m) => m.KChart), { ssr: false });

const PERIOD_CHANGE_LABELS: Record<Timeframe, string> = { D: "今日", W: "本周", M: "本月", Q: "本季" };

interface ChartViewProps {
  symbolKey: string;
  prefs: ChartPrefs;
  prices: Prices;
  formulas: FormulaDef[];
  aliases: Record<string, string>;
  bench: string | null;
  names: Record<string, string>;
  chartState: ChartState;
  note: string | null;
  noteHtml: string | null;
}

export function ChartView({ symbolKey, prefs, prices: initialPrices, formulas, aliases, bench, names, chartState, note, noteHtml }: ChartViewProps) {
  const [tf, setTf] = useState(prefs.tf);
  const [log, setLog] = useState(prefs.log);
  const [chartStyle, setChartStyle] = useState(prefs.style);
  const [prices, setPrices] = useState(initialPrices);
  const [enabled, setEnabled] = useState(prefs.indicators);
  const [overrides, setOverrides] = useState<ParamOverrides>(prefs.params);
  const [hidden, setHidden] = useState<string[]>([]);
  const [legend, setLegend] = useState<CompareLegendEntry[]>([]);
  const [showNotes, setShowNotes] = useState(Boolean(note));
  const [compareOpen, setCompareOpen] = useState(false);
  const [drawRequest, setDrawRequest] = useState<{ tool: string; seq: number } | null>(null);
  const [clearSeq, setClearSeq] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const [data, setData] = useState<BarsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const stateRef = useRef(chartState);
  useEffect(() => {
    stateRef.current = chartState;
  }, [chartState]);
  const paramTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const scope = useMemo(() => ({ aliases, bench }), [aliases, bench]);
  const compiled = useMemo(() => formulas.map((def) => ({ def, ...compileFormula(def.formula, scope) })), [formulas, scope]);

  const compare = chartState.compare;
  const withParam = useMemo(() => {
    const keys = new Set<string>(compare.map((c) => c.key));
    for (const f of compiled) if (f.program && enabled.includes(f.def.id)) f.program.refs.forEach((k) => keys.add(k));
    return [...keys].sort().join(",");
  }, [compare, compiled, enabled]);

  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch below
    setLoading(true);
    const query = new URLSearchParams({ key: symbolKey, tf, prices });
    if (withParam) query.set("with", withParam);
    fetch(`/api/bars?${query}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json as BarsResponse);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [symbolKey, tf, prices, withParam, reloadTick]);

  const report = (result: { ok: boolean; error?: string }) => setMessage(result.ok ? null : (result.error ?? "操作失败"));
  const persist = (partial: Parameters<typeof setChartPrefs>[0]) => void setChartPrefs(partial).then(report);

  const tfOverrides = useMemo(() => overrides[tf] ?? {}, [overrides, tf]);
  const params = useMemo(
    () => Object.fromEntries(INDICATORS.map((d) => [d.name, tfOverrides[d.name] ?? d.params[tf]])),
    [tf, tfOverrides],
  );
  const hasBench = Boolean(bench);
  const templates = useMemo(
    () => compiled.flatMap((f) => (f.program && enabled.includes(f.def.id) ? [formulaTemplate(f.def, f.program, data?.refs ?? {})] : [])),
    [compiled, enabled, data],
  );
  const specs: IndicatorSpec[] = useMemo(
    () => [
      ...INDICATORS.filter((d) => enabled.includes(d.name) && (!d.needsBenchmark || hasBench)).map((d) => ({
        name: d.name,
        pane: d.pane,
        calcParams: params[d.name],
      })),
      ...compiled
        .filter((f) => f.program && enabled.includes(f.def.id))
        .map((f) => ({ name: formulaIndicatorName(f.def.id), pane: f.def.pane, calcParams: [] })),
    ],
    [enabled, hasBench, params, compiled],
  );

  const toggle = (name: string) => {
    const next = enabled.includes(name) ? enabled.filter((n) => n !== name) : [...enabled, name];
    setEnabled(next);
    persist({ indicators: next });
  };
  const setParams = (name: string, value: number[] | null) => {
    const next = { ...tfOverrides };
    if (value) next[name] = value;
    else delete next[name];
    setOverrides({ ...overrides, [tf]: next });
    clearTimeout(paramTimer.current);
    paramTimer.current = setTimeout(() => persist({ params: { [tf]: { [name]: value ?? [] } } }), 600);
  };
  const saveFormula = async (def: FormulaDef) => {
    const result = await saveIndicator(def);
    if (result.ok && !enabled.includes(def.id)) setEnabled([...enabled, def.id]);
    return result.ok ? null : result.error;
  };
  const deleteFormula = async (id: string) => {
    const result = await deleteIndicator(id);
    if (result.ok) setEnabled(enabled.filter((n) => n !== id));
    return result.ok ? null : result.error;
  };

  const saveState = async (next: Partial<ChartState>) => {
    const result = await saveChartState(symbolKey, { ...stateRef.current, ...next });
    report(result);
    return result.ok;
  };
  const onOverlaysChange = (overlays: OverlaySpec[]) => void saveState({ overlays });
  const removeCompare = (key: string) => void saveState({ compare: compare.filter((c) => c.key !== key) });

  const bars = data?.bars;
  const last = bars?.at(-1);
  const prev = bars && bars.length > 1 ? bars[bars.length - 2] : undefined;
  const periodChange = last && prev ? last.close / prev.close - 1 : null;
  const meta = data?.symbol;
  const percentMode = compare.some((c) => c.mode === "percent" && !hidden.includes(c.key));
  const compareWithHidden = useMemo(() => compare.map((c) => ({ ...c, hidden: hidden.includes(c.key) })), [compare, hidden]);

  return (
    <main className="flex w-full flex-1 flex-col px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href="/" className="text-xs text-muted hover:text-fg">
            ← 总览
          </Link>
          <h1 className="text-base font-medium">{meta?.name ?? names[symbolKey] ?? symbolKey}</h1>
          {meta && (
            <span className="font-mono text-[11px] text-muted">
              {meta.ticker} · {meta.source === "expr" ? "合成" : SOURCE_LABELS[meta.source]}
              {meta.currency && ` · ${meta.currency}`}
              {meta.bench && ` · 基准 ${names[meta.bench] ?? meta.bench}`}
            </span>
          )}
          {last && data && (
            <>
              <span className="tabular text-sm">{fmtPrice(last.close, data.pricePrecision)}</span>
              <span className={`tabular text-xs ${changeColor(periodChange)}`}>
                {PERIOD_CHANGE_LABELS[tf]} {fmtPct(periodChange, 2)}
              </span>
            </>
          )}
          {meta && <span className="text-[11px] text-muted">{meta.source === "expr" ? "按需合成" : fmtAgo(meta.syncedAt)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex rounded-md border border-line p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTf(t);
                  persist({ tf: t });
                }}
                className={`rounded px-3 py-0.5 ${t === tf ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}
              >
                {TF_LABELS[t]}
              </button>
            ))}
          </div>
          <select
            value={chartStyle}
            onChange={(e) => {
              const style = e.target.value as ChartStyle;
              setChartStyle(style);
              persist({ style });
            }}
            className="h-6 rounded border border-line bg-bg px-1 text-muted outline-none hover:text-fg"
            title="K 线样式"
          >
            {(Object.keys(CHART_STYLES) as ChartStyle[]).map((s) => (
              <option key={s} value={s}>
                {CHART_STYLES[s]}
              </option>
            ))}
          </select>
          <label className={`flex items-center gap-1.5 ${percentMode ? "cursor-not-allowed opacity-50" : "cursor-pointer"} text-muted`} title={percentMode ? "对比时用百分比坐标" : undefined}>
            <input
              type="checkbox"
              checked={log && !percentMode}
              disabled={percentMode}
              onChange={(e) => {
                setLog(e.target.checked);
                persist({ log: e.target.checked });
              }}
              className="accent-current"
            />
            对数
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-muted" title="总回报：把分红折进价格">
            <input
              type="checkbox"
              checked={prices === "total"}
              onChange={(e) => {
                const next: Prices = e.target.checked ? "total" : "split";
                setPrices(next);
                persist({ prices: next });
              }}
              className="accent-current"
            />
            含分红
          </label>
          <button onClick={() => setCompareOpen((v) => !v)} className={`${compareOpen ? "text-fg" : "text-muted"} hover:text-fg`}>
            对比
          </button>
          <select
            value=""
            onChange={(e) => {
              const tool = e.target.value;
              if (tool === "clear") {
                if (confirm("清除这个标的的全部画线？")) setClearSeq((n) => n + 1);
              } else if (tool) setDrawRequest({ tool, seq: (drawRequest?.seq ?? 0) + 1 });
            }}
            className="h-6 rounded border border-line bg-bg px-1 text-muted outline-none hover:text-fg"
            title="画线：选工具后在图上点击；右键删除一条"
          >
            <option value="">画线</option>
            {DRAW_TOOLS.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
            <option value="clear">清除全部画线</option>
          </select>
          <button onClick={() => setShowNotes((v) => !v)} className={`${showNotes ? "text-fg" : "text-muted"} hover:text-fg`}>
            笔记
          </button>
          <button onClick={() => setReloadTick((n) => n + 1)} disabled={loading} className="text-muted hover:text-fg disabled:opacity-50">
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <IndicatorBar
          enabled={enabled}
          params={params}
          overridden={new Set(Object.keys(tfOverrides))}
          hasBenchmark={hasBench}
          formulas={compiled.map((f) => ({ def: f.def, error: f.error }))}
          scope={scope}
          onToggle={toggle}
          onParams={setParams}
          onSaveFormula={saveFormula}
          onDeleteFormula={deleteFormula}
        />
      </div>

      {compareOpen && (
        <ComparePanel
          aliases={aliases}
          existing={compare}
          onAdd={async (key, mode) => {
            const used = new Set(compare.map((c) => c.color));
            const color = COMPARE_COLORS.find((c) => !used.has(c)) ?? COMPARE_COLORS[compare.length % COMPARE_COLORS.length];
            return saveState({ compare: [...compare, { key, mode, color }] });
          }}
          onClose={() => setCompareOpen(false)}
        />
      )}

      {(error || message) && <p className="mb-2 text-xs text-down">{error ? `加载失败：${error}` : message}</p>}

      <div className="flex min-h-[520px] flex-1 gap-3">
        <div className="relative flex-1 rounded-lg border border-line bg-card">
          <div className="absolute inset-0 p-1">
            <KChart
              symbolKey={symbolKey}
              tf={tf}
              bars={bars ?? null}
              pricePrecision={data?.pricePrecision ?? 2}
              log={log}
              chartStyle={chartStyle}
              indicators={specs}
              templates={templates}
              compare={compareWithHidden}
              refs={data?.refs ?? {}}
              overlays={chartState.overlays}
              onOverlaysChange={onOverlaysChange}
              drawRequest={drawRequest}
              clearSeq={clearSeq}
              onLegend={setLegend}
            />
          </div>
          {compare.length > 0 && (
            <div className="pointer-events-none absolute top-7 left-2 z-10 flex flex-col gap-0.5 text-[11px]">
              {compare.map((c, i) => {
                const entry = legend[i];
                const off = hidden.includes(c.key);
                return (
                  <div key={c.key} className={`pointer-events-auto flex items-center gap-2 rounded bg-card/80 px-1.5 py-0.5 ${off ? "opacity-50" : ""}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                    <span>{names[c.key] ?? c.key}</span>
                    <span className="text-muted">{c.mode === "pane" ? "副图" : ""}</span>
                    {entry?.value != null && <span className="tabular text-muted">{fmtPrice(entry.value)}</span>}
                    {c.mode === "percent" && entry?.pct != null && <span className={`tabular ${changeColor(entry.pct)}`}>{fmtPct(entry.pct)}</span>}
                    <button
                      onClick={() => setHidden(off ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])}
                      className="text-muted hover:text-fg"
                      title={off ? "显示" : "隐藏"}
                    >
                      {off ? "○" : "●"}
                    </button>
                    <button onClick={() => removeCompare(c.key)} className="text-muted hover:text-fg" title="移除对比">
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {showNotes && <NotesPanel symbolKey={symbolKey} note={note} html={noteHtml} onClose={() => setShowNotes(false)} />}
      </div>
    </main>
  );
}

function ComparePanel({
  aliases,
  existing,
  onAdd,
  onClose,
}: {
  aliases: Record<string, string>;
  existing: CompareEntry[];
  onAdd: (key: string, mode: CompareEntry["mode"]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CompareEntry["mode"]>("percent");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const direct = resolveKey(query, aliases);
  const isKey = isValidKey(direct);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || isValidKey(resolveKey(q, aliases))) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<SearchHit[]>) : []))
        .then(setHits)
        .catch(() => undefined);
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, aliases]);

  const add = async (key: string) => {
    if (existing.some((c) => c.key === key)) return;
    setBusy(true);
    if (await onAdd(key, mode)) {
      setQuery("");
      setHits([]);
    }
    setBusy(false);
  };

  return (
    <div className="mb-3 rounded-lg border border-line bg-card p-3 text-xs">
      <form
        className="flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (isKey) void add(direct);
        }}
      >
        <span className="text-muted">对比</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="别名、key 或搜索：QQQ / tv:TVC:US10Y / apple"
          className="h-7 w-72 rounded border border-line bg-bg px-2 font-mono outline-none focus:border-accent"
          autoFocus
        />
        <div className="flex gap-3 text-muted">
          <label className="flex cursor-pointer items-center gap-1">
            <input type="radio" checked={mode === "percent"} onChange={() => setMode("percent")} className="accent-current" />
            主图叠加（同百分比坐标）
          </label>
          <label className="flex cursor-pointer items-center gap-1">
            <input type="radio" checked={mode === "pane"} onChange={() => setMode("pane")} className="accent-current" />
            独立副图
          </label>
        </div>
        <button type="submit" disabled={!isKey || busy} className="rounded bg-fg px-3 py-1 text-bg disabled:opacity-40">
          {busy ? "拉取中…" : "添加"}
        </button>
        <button type="button" onClick={onClose} className="text-muted hover:text-fg">
          关闭
        </button>
      </form>
      {!isKey && hits.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {hits.map((h) => (
            <li key={h.key}>
              <button type="button" onClick={() => void add(h.key)} disabled={busy} className="rounded-full border border-line px-2.5 py-1 hover:border-muted" title={h.key}>
                <span className="font-mono">{h.key}</span>
                <span className="ml-1.5 text-muted">{h.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
