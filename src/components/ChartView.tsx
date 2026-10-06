"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { deleteIndicator, saveChartState, saveIndicator, setChartPrefs } from "@/app/actions";
import { INDICATORS } from "@/indicators/catalog";
import { compileFormula, formulaIndicatorName, formulaTemplate } from "@/indicators/formula-indicators";
import type { BarsResponse } from "@/lib/api-types";
import { CHART_STYLES, type ChartPrefs, type ChartStyle, type FormulaDef, type ParamOverrides } from "@/lib/config";
import { changeColor, fmtAgo, fmtPct, fmtPrice } from "@/lib/format";
import type { Prices } from "@/lib/series";
import { SOURCE_LABELS, TF_LABELS, TIMEFRAMES, type Timeframe } from "@/lib/symbols";
import type { ChartState, CompareEntry, OverlaySpec } from "@/lib/vault";
import type { SearchContext } from "@/lib/search";
import { COMPARE_COLORS, DRAW_TOOLS, type CompareLegendEntry, type IndicatorSpec } from "./chart-types";
import { IndicatorBar } from "./IndicatorBar";
import { NotesPanel } from "./NotesPanel";
import { SymbolSearch } from "./SymbolSearch";
import { chartHref, isEditable, useUi } from "./UiProvider";

const KChart = dynamic(() => import("./KChart").then((m) => m.KChart), { ssr: false });

const PERIOD_CHANGE_LABELS: Record<Timeframe, string> = { D: "今日", W: "本周", M: "本月", Q: "本季" };

interface ChartViewProps {
  symbolKey: string;
  prefs: ChartPrefs;
  prices: Prices;
  formulas: FormulaDef[];
  aliases: Record<string, string>;
  bench: string | null;
  benchLabel: string | null;
  names: Record<string, string>;
  /** The watchlist in yaml order, for ←/→ */
  order: { key: string; name: string }[];
  chartState: ChartState;
  note: string | null;
  noteHtml: string | null;
}

export function ChartView({ symbolKey, prefs, prices: initialPrices, formulas, aliases, bench, benchLabel, names, order, chartState, note, noteHtml }: ChartViewProps) {
  const router = useRouter();
  const { openSearch, searchCtx } = useUi();
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
  const [closeSeq, setCloseSeq] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // ←/→ and j/k walk the watchlist in yaml order; Esc closes whatever panel is open
  const position = order.findIndex((o) => o.key === symbolKey);
  const neighbour = (step: 1 | -1) => (position < 0 || order.length < 2 ? null : order[(position + step + order.length) % order.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        setCompareOpen(false);
        setCloseSeq((n) => n + 1);
        return;
      }
      const step = e.key === "ArrowRight" || e.key === "j" ? 1 : e.key === "ArrowLeft" || e.key === "k" ? -1 : 0;
      if (!step) return;
      const target = neighbour(step);
      if (!target) return;
      e.preventDefault();
      router.push(chartHref(target.key));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- neighbour derives from order/position
  }, [order, position, router]);

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

  const nextKey = neighbour(1)?.key ?? null;
  useEffect(() => {
    if (!data || !nextKey) return;
    const query = new URLSearchParams({ key: nextKey, tf, prices });
    void fetch(`/api/bars?${query}`, { priority: "low" }).catch(() => undefined);
  }, [data, nextKey, tf, prices]);

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
  // KLineChart writes one tooltip row for the candle and one per main-pane indicator; the legend goes under them
  const legendTop = 8 + 20 * (1 + specs.filter((s) => s.pane === "main").length);

  return (
    <main className="flex w-full flex-1 flex-col px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-3">
          <Link href="/" className="text-xs text-muted hover:text-fg">
            ← 总览
          </Link>
          <button onClick={() => openSearch()} className="text-base font-medium hover:text-accent" title="换一个标的（/ 或直接敲字母）">
            {names[symbolKey] ?? meta?.name ?? symbolKey}
          </button>
          {position >= 0 && order.length > 1 && (
            <span className="flex items-center gap-1 font-mono text-[11px] text-muted" title="← → 或 j k 切换上一只 / 下一只">
              <button onClick={() => router.push(chartHref(neighbour(-1)!.key))} className="btn h-5 px-1" aria-label="上一只">
                ‹
              </button>
              {position + 1} / {order.length}
              <button onClick={() => router.push(chartHref(neighbour(1)!.key))} className="btn h-5 px-1" aria-label="下一只">
                ›
              </button>
            </span>
          )}
          {meta && (
            <span className="font-mono text-[11px] text-muted">
              {meta.ticker} · {meta.source === "expr" ? "合成" : SOURCE_LABELS[meta.source]}
              {meta.currency && ` · ${meta.currency}`}
              {meta.bench && ` · 基准 ${benchLabel ?? names[meta.bench] ?? meta.bench}`}
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
          closeSeq={closeSeq}
        />
      </div>

      {compareOpen && (
        <ComparePanel
          ctx={searchCtx}
          symbolKey={symbolKey}
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
            <div className="pointer-events-none absolute left-2 z-10 flex flex-col gap-0.5 text-[11px]" style={{ top: legendTop }}>
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
        {showNotes && <NotesPanel symbolKey={symbolKey} note={note} html={noteHtml} onClose={() => setShowNotes(false)} closeSeq={closeSeq} />}
      </div>
    </main>
  );
}

function ComparePanel({
  ctx,
  symbolKey,
  existing,
  onAdd,
  onClose,
}: {
  ctx: SearchContext;
  symbolKey: string;
  existing: CompareEntry[];
  onAdd: (key: string, mode: CompareEntry["mode"]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<CompareEntry["mode"]>("percent");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mb-3 rounded-lg border border-line bg-card text-xs">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <span className="font-medium">对比</span>
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
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="text-muted hover:text-fg">
          关闭
        </button>
      </div>
      <SymbolSearch
        mode="pick"
        ctx={ctx}
        placeholder="别名、key 或搜索：QQQ / tv:TVC:US10Y / apple"
        exclude={[symbolKey, ...existing.map((c) => c.key)]}
        busy={busy}
        error={error}
        onPick={async (d) => {
          setBusy(true);
          setError(null);
          const ok = await onAdd(d.key, mode);
          setBusy(false);
          if (!ok) setError(`无法拉取 ${d.key}`);
        }}
        onClose={onClose}
      />
    </div>
  );
}
