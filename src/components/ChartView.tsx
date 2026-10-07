"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { deleteIndicator, saveChartState, saveIndicator, setChartPrefs } from "@/app/actions";
import type { AlertView } from "@/lib/alert-view";
import { INDICATORS } from "@/indicators/catalog";
import { compileFormula, formulaIndicatorName, formulaTemplate, isFormulaIndicator } from "@/indicators/formula-indicators";
import type { BarsResponse } from "@/lib/api-types";
import { CHART_STYLES, type ChartPrefs, type ChartStyle, type FormulaDef, type ParamOverrides } from "@/lib/config";
import { fmtAgo } from "@/lib/format";
import { setChartContext } from "@/lib/page-context";
import type { Prices } from "@/lib/series";
import { SOURCE_LABELS, TF_LABELS, TIMEFRAMES, tickerOf, type Timeframe } from "@/lib/symbols";
import { useLocalStorage } from "@/lib/use-local-storage";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ChartState, OverlaySpec } from "@/lib/vault";
import {
  IconArea,
  IconBack,
  IconBars,
  IconCandles,
  IconCaret,
  IconCursor,
  IconExtendedLine,
  IconEye,
  IconFib,
  IconFullscreen,
  IconHelp,
  IconHollowCandles,
  IconHorizontalLine,
  IconHorizontalRay,
  IconLock,
  IconMagnet,
  IconNotes,
  IconAlarm,
  IconPencil,
  IconPlus,
  IconRay,
  IconRefresh,
  IconSearch,
  IconText,
  IconTrash,
  IconTrendLine,
  IconVerticalLine,
  IconWatchlist,
} from "./chart-icons";
import { COMPARE_COLORS, DRAW_TOOLS, RANGES, SUB_PANE_HEIGHT, type ChartControl, type IndicatorSpec } from "./chart-types";
import { AlertDialog, AlertLoginDialog } from "./AlertDialog";
import { AlertsPanel } from "./AlertsPanel";
import { CompareDialog } from "./CompareDialog";
import { Dialog, Dropdown } from "./Dialog";
import { IndicatorDialog, ParamDialog } from "./IndicatorDialog";
import type { DrawingModes } from "./KChart";
import { LoginPrompt, NotesPanel } from "./NotesPanel";
import { chartHref, isEditable, useUi } from "./UiProvider";
import { WatchlistPanel, type WatchlistGroup } from "./WatchlistPanel";

const KChart = dynamic(() => import("./KChart").then((m) => m.KChart), { ssr: false });

const STYLE_ICONS: Record<ChartStyle, (p: { size?: number }) => ReactNode> = {
  candle_solid: IconCandles,
  candle_up_stroke: IconHollowCandles,
  ohlc: IconBars,
  area: IconArea,
};

const TOOL_ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  segment: IconTrendLine,
  rayLine: IconRay,
  straightLine: IconExtendedLine,
  horizontalStraightLine: IconHorizontalLine,
  horizontalRayLine: IconHorizontalRay,
  verticalStraightLine: IconVerticalLine,
  fibonacciLine: IconFib,
  simpleAnnotation: IconText,
};

type Panel = "watchlist" | "notes" | "alerts";
type DialogState =
  | { kind: "indicators"; formula?: FormulaDef | "new" }
  | { kind: "compare" }
  | { kind: "params"; name: string }
  | { kind: "clear" }
  /** 新建警报 at a price, or 编辑警报 */
  | { kind: "alert"; alert: AlertView | null; price: number | null }
  | null;

const DEFAULT_DRAWING: DrawingModes = { magnet: false, locked: false, hidden: false };

interface ChartViewProps {
  symbolKey: string;
  prefs: ChartPrefs;
  prices: Prices;
  formulas: FormulaDef[];
  aliases: Record<string, string>;
  bench: string | null;
  benchLabel: string | null;
  names: Record<string, string>;
  /** The watchlist as grouped in the yaml, for the side panel and Space / Shift+Space */
  watchlist: WatchlistGroup[];
  /** Label of the change column in the watchlist panel (the overview's first period) */
  changeLabel: string;
  chartState: ChartState;
  note: string | null;
  noteHtml: string | null;
  noteSavedAt: number | null;
  /** A visitor on a shared instance: preferences stay in this page, drawings and notes need a login */
  readOnly: boolean;
  /** The viewer's vault ('' = root), for per-person drafts */
  vault: string;
  /** Every alert of the viewer's vault (none for a visitor) */
  alerts: AlertView[];
  /** The latest price of this symbol, where a new alert starts */
  livePrice: number | null;
}

export function ChartView({
  symbolKey,
  prefs,
  prices: initialPrices,
  formulas,
  aliases,
  bench,
  benchLabel,
  names,
  watchlist,
  changeLabel,
  chartState,
  note,
  noteHtml,
  noteSavedAt,
  readOnly,
  vault,
  alerts,
  livePrice,
}: ChartViewProps) {
  const router = useRouter();
  const { openSearch, openHelp, searchCtx, toast } = useUi();
  const [tf, setTf] = useState(prefs.tf);
  const [log, setLog] = useState(prefs.log);
  const [chartStyle, setChartStyle] = useState(prefs.style);
  const [prices, setPrices] = useState(initialPrices);
  const [enabled, setEnabled] = useState(prefs.indicators);
  const [overrides, setOverrides] = useState<ParamOverrides>(prefs.params);
  const [hiddenCompares, setHiddenCompares] = useState<string[]>([]);
  const [hiddenIndicators, setHiddenIndicators] = useState<string[]>([]);
  const [pctAxis, setPctAxis] = useLocalStorage("hebi8:chart:pct", false);
  const [drawing, setDrawing] = useLocalStorage<DrawingModes>("hebi8:chart:drawing", DEFAULT_DRAWING);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [drawTool, setDrawTool] = useState<string | null>(null);
  const [clearSeq, setClearSeq] = useState(0);
  const [autoScale, setAutoScale] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const control = useRef<ChartControl | null>(null);

  // right panel: one at a time, remembered on wide screens; a bottom sheet that starts closed on narrow ones
  const wide = useMediaQuery("(min-width: 768px)");
  const [storedPanel, setStoredPanel] = useLocalStorage<Panel | "none" | null>("hebi8:chart:panel", null);
  const [sheet, setSheet] = useState<Panel | null>(null);
  const panel: Panel | null = wide ? (storedPanel === "none" ? null : (storedPanel ?? (note ? "notes" : null))) : sheet;
  const togglePanel = (p: Panel) => {
    const next = panel === p ? null : p;
    if (wide) setStoredPanel(next ?? "none");
    else setSheet(next);
  };

  const order = useMemo(() => watchlist.flatMap((g) => g.items), [watchlist]);
  const position = order.findIndex((o) => o.key === symbolKey);
  const neighbour = (step: 1 | -1) => (order.length < 2 ? null : order[(Math.max(position, step > 0 ? -1 : 0) + step + order.length) % order.length]);

  const [data, setData] = useState<BarsResponse | null>(null);
  const [dataTf, setDataTf] = useState<Timeframe>(tf);
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
        setDataTf(tf);
        setError(null);
      })
      .catch((err: Error) => {
        if (err.name !== "AbortError") setError(err.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [symbolKey, tf, prices, withParam, reloadTick]);

  // Space opens the next symbol, so warm its bars up
  const nextKey = neighbour(1)?.key ?? null;
  useEffect(() => {
    if (!data || !nextKey) return;
    const query = new URLSearchParams({ key: nextKey, tf, prices });
    void fetch(`/api/bars?${query}`, { priority: "low" }).catch(() => undefined);
  }, [data, nextKey, tf, prices]);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  /** TradingView: a new alert starts at the latest price unless it came from a price on the chart */
  const openAlert = (price?: number) => setDialog({ kind: "alert", alert: null, price: price ?? livePrice ?? data?.bars.at(-1)?.close ?? null });
  const report = (result: { ok: boolean; error?: string }) => setMessage(result.ok ? null : (result.error ?? "操作失败"));
  const persist = (partial: Parameters<typeof setChartPrefs>[0]) => {
    if (!readOnly) void setChartPrefs(partial).then(report);
  };

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
        hidden: hiddenIndicators.includes(d.name),
        precision: d.precision,
      })),
      ...compiled
        .filter((f) => f.program && enabled.includes(f.def.id))
        .map((f) => {
          const name = formulaIndicatorName(f.def.id);
          return { name, pane: f.def.pane, calcParams: [], hidden: hiddenIndicators.includes(name) };
        }),
    ],
    [enabled, hasBench, params, compiled, hiddenIndicators],
  );
  const labels = useMemo(
    () => Object.fromEntries([...INDICATORS.map((d) => [d.name, d.label]), ...formulas.map((f) => [formulaIndicatorName(f.id), f.label])]),
    [formulas],
  );

  const changeTf = (next: Timeframe) => {
    setTf(next);
    persist({ tf: next });
  };
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
    if (readOnly) {
      setMessage("登录后才能保存画线和比较商品");
      return false;
    }
    const result = await saveChartState(symbolKey, { ...stateRef.current, ...next });
    report(result);
    return result.ok;
  };
  const onOverlaysChange = (overlays: OverlaySpec[]) => void saveState({ overlays });
  const removeCompare = (key: string) => void saveState({ compare: compare.filter((c) => c.key !== key) });

  // legend row actions: eye, gear (or double click), ×
  const onIndicator = (name: string, action: "toggle" | "settings" | "remove") => {
    const id = isFormulaIndicator(name) ? name.slice(2) : name;
    if (action === "toggle") setHiddenIndicators((h) => (h.includes(name) ? h.filter((n) => n !== name) : [...h, name]));
    else if (action === "remove") {
      if (enabled.includes(id)) toggle(id);
    } else if (isFormulaIndicator(name)) {
      const def = formulas.find((f) => f.id === id);
      if (def) setDialog({ kind: "indicators", formula: def });
    } else setDialog({ kind: "params", name });
  };
  const onCompare = (key: string, action: "toggle" | "remove") => {
    if (action === "remove") removeCompare(key);
    else setHiddenCompares((h) => (h.includes(key) ? h.filter((k) => k !== key) : [...h, key]));
  };

  const chooseTool = (name: string | null) => {
    // TradingView shows hidden drawings again when you start a new one
    if (name && drawing.hidden) setDrawing({ ...drawing, hidden: false });
    setDrawTool((cur) => (cur === name ? null : name));
  };

  const go = (step: 1 | -1) => {
    const target = neighbour(step);
    if (target) router.push(chartHref(target.key));
  };

  // range buttons fit the bars; when they would be under a pixel each, step up to a longer timeframe like TV
  const pendingRange = useRef<number | null | undefined>(undefined);
  const fitRange = (years: number | null) => {
    const c = control.current;
    if (!c || c.fitRange(years)) return;
    const next = TIMEFRAMES[TIMEFRAMES.indexOf(tf) + 1];
    if (!next) return;
    pendingRange.current = years;
    changeTf(next);
  };
  useEffect(() => {
    if (pendingRange.current === undefined || !data || dataTf !== tf) return;
    const years = pendingRange.current;
    pendingRange.current = undefined;
    fitRange(years);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once the new timeframe's bars are in
  }, [data, dataTf, tf]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => setMessage("浏览器不允许全屏"));
  };

  // TradingView hotkeys; the latest closure is kept in a ref so the listener is attached once
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    onKeyRef.current = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      // Esc works from inside an editor's own input too; the search overlay stops its own Esc
      if (e.key === "Escape") {
        setDialog(null);
        setDrawTool(null);
        if (isEditable(e.target)) (e.target as HTMLElement).blur();
        return;
      }
      if (isEditable(e.target) || dialog) return;
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const tool = DRAW_TOOLS.find((t) => t.code === e.code);
        if (tool) {
          e.preventDefault();
          chooseTool(tool.name);
        } else if (e.code === "KeyR") {
          e.preventDefault();
          control.current?.reset();
        } else if (e.code === "KeyA") {
          e.preventDefault();
          openAlert();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const c = control.current;
      switch (e.key) {
        case "Delete":
        case "Backspace":
          if (c?.deleteSelected()) e.preventDefault();
          return;
        case "ArrowLeft":
        case "ArrowRight":
          if (e.shiftKey) return; // KLineChart's own Shift+arrow scroll
          e.preventDefault();
          c?.scroll(e.key === "ArrowLeft" ? -0.1 : 0.1);
          return;
        case "ArrowUp":
        case "ArrowDown":
          e.preventDefault();
          c?.zoom(e.key === "ArrowUp" ? 1.25 : 0.8);
          return;
        case " ":
          e.preventDefault();
          (document.activeElement as HTMLElement | null)?.blur?.();
          go(e.shiftKey ? -1 : 1);
          return;
      }
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // what in-app feedback attaches about this chart
  useEffect(() => {
    setChartContext({
      symbol: symbolKey,
      tf,
      style: chartStyle,
      log,
      prices,
      indicators: enabled,
      compares: compare.map((c) => ({ key: c.key, mode: c.mode })),
    });
  }, [symbolKey, tf, chartStyle, log, prices, enabled, compare]);
  useEffect(() => () => setChartContext(null), []);

  const bars = data?.bars;
  const meta = data?.symbol;
  const alertLines = useMemo(() => alerts.filter((a) => a.key === symbolKey).flatMap((a) => a.levels.map((price) => ({ id: a.id, price }))), [alerts, symbolKey]);
  const forcedPercent = compare.some((c) => c.mode === "percent" && !hiddenCompares.includes(c.key));
  const percentOn = forcedPercent || pctAxis;
  const compareWithHidden = useMemo(() => compare.map((c) => ({ ...c, hidden: hiddenCompares.includes(c.key) })), [compare, hiddenCompares]);
  const subPanes = specs.filter((s) => s.pane === "sub").length + compare.filter((c) => c.mode === "pane").length;
  const drawLabel = DRAW_TOOLS.find((t) => t.name === drawTool)?.label;
  const name = names[symbolKey] ?? meta?.name ?? symbolKey;
  const ticker = meta?.ticker ?? tickerOf(symbolKey);
  const sourceLabel = meta ? (meta.source === "expr" ? "合成" : SOURCE_LABELS[meta.source]) : null;
  const syncText = meta ? (meta.source === "expr" ? "按需合成" : fmtAgo(meta.syncedAt)) : "";
  const subtitle = [
    TF_LABELS[dataTf],
    ...(sourceLabel ? [sourceLabel] : []),
    ...(meta?.currency ? [meta.currency] : []),
    ...(meta?.bench ? [`基准 ${benchLabel ?? names[meta.bench] ?? meta.bench}`] : []),
  ];
  const StyleIcon = STYLE_ICONS[chartStyle];
  const paramDef = dialog?.kind === "params" ? INDICATORS.find((d) => d.name === dialog.name) : undefined;

  const clearDrawings = () => {
    if (chartState.overlays.length === 0) return;
    // in-page confirm: a native confirm() would drop fullscreen
    setDialog({ kind: "clear" });
  };
  const confirmClearDrawings = () => {
    setDialog(null);
    setDrawTool(null);
    setClearSeq((n) => n + 1);
  };
  const drawingMenu = (close: () => void) => (
    <>
      <button role="menuitem" className="menu-item flex items-center gap-2" onClick={() => {
          chooseTool(null);
          close();
        }}>
        <IconCursor /> 十字光标
      </button>
      {DRAW_TOOLS.map((t) => {
        const Icon = TOOL_ICONS[t.name];
        return (
          <button key={t.name} role="menuitem" className={`menu-item flex items-center gap-2 ${drawTool === t.name ? "font-medium" : ""}`} onClick={() => {
              chooseTool(t.name);
              close();
            }}>
            <Icon /> {t.label}
          </button>
        );
      })}
      <div className="my-1 h-px bg-line" />
      <button role="menuitem" className="menu-item flex items-center gap-2" onClick={() => setDrawing({ ...drawing, magnet: !drawing.magnet })}>
        <IconMagnet /> 磁铁模式{drawing.magnet && " ✓"}
      </button>
      <button role="menuitem" className="menu-item flex items-center gap-2" onClick={() => setDrawing({ ...drawing, locked: !drawing.locked })}>
        <IconLock open={!drawing.locked} /> 锁定所有绘图{drawing.locked && " ✓"}
      </button>
      <button role="menuitem" className="menu-item flex items-center gap-2" onClick={() => setDrawing({ ...drawing, hidden: !drawing.hidden })}>
        <IconEye off={drawing.hidden} /> 隐藏所有绘图{drawing.hidden && " ✓"}
      </button>
      <button role="menuitem" className="menu-item flex items-center gap-2 text-down" onClick={() => {
          close();
          clearDrawings();
        }}>
        <IconTrash /> 删除所有绘图
      </button>
    </>
  );
  const panelContent =
    panel === "watchlist" ? (
      <WatchlistPanel
        groups={watchlist}
        changeLabel={changeLabel}
        current={symbolKey}
        onPick={(key) => {
          if (!wide) setSheet(null);
          if (key !== symbolKey) router.push(chartHref(key));
        }}
        onClose={() => togglePanel("watchlist")}
        className="h-full"
      />
    ) : panel === "alerts" ? (
      <AlertsPanel
        alerts={alerts}
        current={symbolKey}
        readOnly={readOnly}
        onCreate={() => openAlert()}
        onEdit={(alert) => setDialog({ kind: "alert", alert, price: null })}
        onClose={() => togglePanel("alerts")}
        className="h-full"
      />
    ) : panel === "notes" ? (
      readOnly ? (
        <LoginPrompt text="登录后看自己的笔记" onClose={() => togglePanel("notes")} className="h-full" />
      ) : (
        <NotesPanel key={vault} vault={vault} symbolKey={symbolKey} note={note} html={noteHtml} savedAt={noteSavedAt} onClose={() => togglePanel("notes")} className="h-full" />
      )
    ) : null;

  return (
    <main
      className="flex w-full flex-col overflow-hidden bg-card"
      style={{ height: "calc(100dvh - var(--site-header-h))", minHeight: chartMinHeight(subPanes) + 70 }}
    >
      {/* top toolbar: one row, scrolls sideways on narrow screens */}
      <div className="scroll-row flex h-[38px] shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1.5" role="toolbar" aria-label="图表工具栏">
        <Link href="/" className="tb-btn" title="返回总览">
          <IconBack />
          <span className="hidden text-xs text-muted lg:inline">总览</span>
        </Link>
        <span className="tb-sep" />
        <button type="button" onClick={() => openSearch()} className="tb-btn max-w-[16rem] px-2" title={`${name} · 商品代码搜索（直接敲字母，或 /）`}>
          <IconSearch size={16} />
          <span className="font-semibold">{ticker}</span>
          {name !== ticker && <span className="hidden truncate text-xs text-muted sm:inline">{name}</span>}
        </button>
        <button type="button" onClick={() => setDialog({ kind: "compare" })} className="tb-btn" title="比较商品" aria-label="比较商品">
          <IconPlus />
          {compare.length > 0 && <span className="text-[11px] text-muted">{compare.length}</span>}
        </button>
        <span className="tb-sep" />
        {TIMEFRAMES.map((t) => (
          <button key={t} type="button" onClick={() => changeTf(t)} aria-pressed={t === tf} className="tb-btn min-w-[30px] px-1.5" title={`${TF_LABELS[t]}线`}>
            {TF_LABELS[t]}
          </button>
        ))}
        <span className="tb-sep" />
        <Dropdown label={<><StyleIcon /><IconCaret className="text-muted" /></>} title={`图表类型：${CHART_STYLES[chartStyle]}`} menuClassName="min-w-[9rem]">
          {(close) =>
            (Object.keys(CHART_STYLES) as ChartStyle[]).map((s) => {
              const Icon = STYLE_ICONS[s];
              return (
                <button
                  key={s}
                  role="menuitemradio"
                  aria-checked={s === chartStyle}
                  onClick={() => {
                    setChartStyle(s);
                    persist({ style: s });
                    close();
                  }}
                  className={`menu-item flex items-center gap-2 ${s === chartStyle ? "font-medium" : ""}`}
                >
                  <Icon /> {CHART_STYLES[s]}
                </button>
              );
            })
          }
        </Dropdown>
        <span className="tb-sep" />
        <button type="button" onClick={() => setDialog({ kind: "indicators" })} className="tb-btn px-2" title="指标">
          <span className="font-serif text-[15px] italic">fx</span>
          <span>指标</span>
        </button>
        <button type="button" onClick={() => openAlert()} className="tb-btn px-2" title="创建警报 · Alt+A">
          <IconAlarm />
          <span className="hidden sm:inline">警报</span>
        </button>
        {/* narrow screens: drawing tools and the side panels live in the top bar */}
        <span className="tb-sep md:hidden" />
        <span className="flex md:hidden">
          <Dropdown label={<><IconPencil /><span className="text-xs">画线</span></>} title="画线工具" pressed={Boolean(drawTool)} menuClassName="min-w-[12rem]">
            {drawingMenu}
          </Dropdown>
          <button type="button" onClick={() => togglePanel("watchlist")} aria-pressed={panel === "watchlist"} className="tb-btn" title="自选列表" aria-label="自选列表">
            <IconWatchlist />
          </button>
          <button type="button" onClick={() => togglePanel("notes")} aria-pressed={panel === "notes"} className="tb-btn" title="笔记" aria-label="笔记">
            <IconNotes />
          </button>
          <button type="button" onClick={() => togglePanel("alerts")} aria-pressed={panel === "alerts"} className="tb-btn" title="警报列表" aria-label="警报列表">
            <IconAlarm />
          </button>
        </span>
        <span className="min-w-2 flex-1" />
        <button type="button" onClick={() => setReloadTick((n) => n + 1)} disabled={loading} className="tb-btn" title={`刷新 · ${loading ? "加载中…" : syncText}`} aria-label="刷新">
          <IconRefresh className={loading ? "animate-spin" : ""} />
        </button>
        {/* the site header (and its "?") is hidden in fullscreen */}
        {fullscreen && (
          <button type="button" onClick={() => openHelp()} className="tb-btn" title="帮助与反馈 · ?" aria-label="帮助与反馈">
            <IconHelp />
          </button>
        )}
        <button type="button" onClick={toggleFullscreen} className="tb-btn" title={fullscreen ? "退出全屏" : "全屏"} aria-label={fullscreen ? "退出全屏" : "全屏"}>
          <IconFullscreen exit={fullscreen} />
        </button>
      </div>

      {(error || message) && <p className="shrink-0 border-b border-line px-3 py-1 text-xs text-down">{error ? `加载失败：${error}` : message}</p>}

      <div className="flex min-h-0 flex-1">
        {/* left drawing toolbar */}
        <div className="hidden w-[42px] shrink-0 flex-col items-center gap-0.5 overflow-y-auto border-r border-line py-1.5 md:flex" role="toolbar" aria-label="画线工具" aria-orientation="vertical">
          <button type="button" onClick={() => chooseTool(null)} aria-pressed={!drawTool} className="tb-btn" title="十字光标 · Esc" aria-label="十字光标">
            <IconCursor />
          </button>
          {DRAW_TOOLS.map((t) => {
            const Icon = TOOL_ICONS[t.name];
            return (
              <button
                key={t.name}
                type="button"
                onClick={() => chooseTool(t.name)}
                aria-pressed={drawTool === t.name}
                className="tb-btn"
                title={t.hotkey ? `${t.label} · ${t.hotkey}` : t.label}
                aria-label={t.label}
              >
                <Icon />
              </button>
            );
          })}
          <span className="tb-sep-h" />
          <button
            type="button"
            onClick={() => setDrawing({ ...drawing, magnet: !drawing.magnet })}
            aria-pressed={drawing.magnet}
            className="tb-btn"
            title={drawing.magnet ? "磁铁模式：开（吸附到开高低收）" : "磁铁模式"}
            aria-label="磁铁模式"
          >
            <IconMagnet />
          </button>
          <button
            type="button"
            onClick={() => setDrawing({ ...drawing, locked: !drawing.locked })}
            aria-pressed={drawing.locked}
            className="tb-btn"
            title={drawing.locked ? "解锁所有绘图" : "锁定所有绘图"}
            aria-label="锁定所有绘图"
          >
            <IconLock open={!drawing.locked} />
          </button>
          <button
            type="button"
            onClick={() => setDrawing({ ...drawing, hidden: !drawing.hidden })}
            aria-pressed={drawing.hidden}
            className="tb-btn"
            title={drawing.hidden ? "显示所有绘图" : "隐藏所有绘图"}
            aria-label="隐藏所有绘图"
          >
            <IconEye off={drawing.hidden} />
          </button>
          <button type="button" onClick={clearDrawings} disabled={chartState.overlays.length === 0} className="tb-btn" title="删除所有绘图" aria-label="删除所有绘图">
            <IconTrash />
          </button>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            {drawLabel && (
              <div className="pointer-events-none absolute top-2 left-1/2 z-20 -translate-x-1/2 rounded border border-line bg-card/95 px-2 py-1 text-[11px] text-muted" role="status">
                {drawLabel} · 在主图上点击 · Esc 退出
              </div>
            )}
            <div className="absolute inset-0">
              <KChart
                symbolKey={symbolKey}
                tf={dataTf}
                bars={bars ?? null}
                pricePrecision={data?.pricePrecision ?? 2}
                log={log}
                percentAxis={pctAxis}
                chartStyle={chartStyle}
                indicators={specs}
                templates={templates}
                compare={compareWithHidden}
                refs={data?.refs ?? {}}
                overlays={chartState.overlays}
                onOverlaysChange={onOverlaysChange}
                drawTool={drawTool}
                onDrawDone={() => setDrawTool(null)}
                clearSeq={clearSeq}
                drawing={drawing}
                controlRef={control}
                onAutoScaleChange={setAutoScale}
                legend={{ title: name, subtitle, names, labels, hiddenIndicators, onIndicator, onCompare }}
                alertLines={alertLines}
                onAddAlert={openAlert}
                onEditAlert={(id) => {
                  const alert = alerts.find((a) => a.id === id);
                  if (alert) setDialog({ kind: "alert", alert, price: null });
                }}
              />
            </div>
          </div>

          {/* bottom bar: date ranges left, scale toggles right */}
          <div className="scroll-row flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-t border-line px-1.5" role="toolbar" aria-label="范围与坐标">
            {RANGES.map((r) => (
              <button key={r.label} type="button" onClick={() => fitRange(r.years)} className="tb-btn h-6 px-1.5 text-xs" title={r.years ? `显示最近 ${r.years} 年` : "显示全部历史"}>
                {r.label}
              </button>
            ))}
            <span className="min-w-2 flex-1" />
            <button
              type="button"
              onClick={() => {
                const next: Prices = prices === "total" ? "split" : "total";
                setPrices(next);
                persist({ prices: next });
              }}
              aria-pressed={prices === "total"}
              className="tb-btn h-6 px-1.5 text-xs"
              title="ADJ 含分红：把分红折进价格（总回报）"
            >
              ADJ
            </button>
            <span className="tb-sep" />
            <button
              type="button"
              onClick={() => {
                if (forcedPercent) return;
                if (!pctAxis && log) {
                  setLog(false);
                  persist({ log: false });
                }
                setPctAxis(!pctAxis);
              }}
              aria-pressed={percentOn}
              data-locked={forcedPercent}
              className="tb-btn h-6 px-1.5 text-xs"
              title={forcedPercent ? "比较模式下使用百分比坐标" : "百分比坐标"}
            >
              %
            </button>
            <button
              type="button"
              onClick={() => {
                if (!log && pctAxis) setPctAxis(false);
                setLog(!log);
                persist({ log: !log });
              }}
              aria-pressed={log && !percentOn}
              disabled={forcedPercent}
              className="tb-btn h-6 px-1.5 text-xs"
              title={forcedPercent ? "比较模式下使用百分比坐标" : "对数坐标"}
            >
              log
            </button>
            <button
              type="button"
              onClick={() => control.current?.autoScale()}
              aria-pressed={autoScale}
              className="tb-btn h-6 px-1.5 text-xs"
              title="自动缩放价格坐标（拖动价格轴后点这里恢复）· Alt+R 重置图表"
            >
              自动
            </button>
          </div>
        </div>

        {panel && wide && <div className="w-[280px] shrink-0 border-l border-line">{panelContent}</div>}

        {/* right icon strip */}
        <div className="hidden w-[42px] shrink-0 flex-col items-center gap-0.5 border-l border-line py-1.5 md:flex" role="toolbar" aria-label="侧栏" aria-orientation="vertical">
          <button type="button" onClick={() => togglePanel("watchlist")} aria-pressed={panel === "watchlist"} className="tb-btn" title="自选列表 · Space / Shift+Space 下一只 / 上一只" aria-label="自选列表">
            <IconWatchlist />
          </button>
          <button type="button" onClick={() => togglePanel("notes")} aria-pressed={panel === "notes"} className="tb-btn" title="笔记" aria-label="笔记">
            <IconNotes />
          </button>
          <button type="button" onClick={() => togglePanel("alerts")} aria-pressed={panel === "alerts"} className="tb-btn" title="警报" aria-label="警报列表">
            <IconAlarm />
          </button>
        </div>
      </div>

      {panel && !wide && (
        <div className="fixed inset-x-0 bottom-0 z-40 h-[60vh] overflow-hidden rounded-t-lg border-t border-line bg-card shadow-[0_-8px_24px_rgb(0_0_0/0.15)]">{panelContent}</div>
      )}

      {dialog?.kind === "indicators" && (
        <IndicatorDialog
          enabled={enabled}
          hasBenchmark={hasBench}
          formulas={compiled.map((f) => ({ def: f.def, error: f.error }))}
          scope={scope}
          initialFormula={dialog.formula}
          onToggle={toggle}
          onSaveFormula={saveFormula}
          onDeleteFormula={deleteFormula}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "compare" && (
        <CompareDialog
          ctx={searchCtx}
          symbolKey={symbolKey}
          existing={compare}
          names={names}
          onAdd={async (key, mode) => {
            const used = new Set(compare.map((c) => c.color));
            const color = COMPARE_COLORS.find((c) => !used.has(c)) ?? COMPARE_COLORS[compare.length % COMPARE_COLORS.length];
            return saveState({ compare: [...compare, { key, mode, color }] });
          }}
          onRemove={removeCompare}
          onClose={() => setDialog(null)}
        />
      )}
      {paramDef && (
        <ParamDialog
          key={`${paramDef.name}:${tf}`}
          def={paramDef}
          tf={tf}
          value={params[paramDef.name] ?? []}
          overridden={paramDef.name in tfOverrides}
          onSave={(p) => setParams(paramDef.name, p)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "alert" &&
        (readOnly ? (
          <AlertLoginDialog onClose={() => setDialog(null)} />
        ) : (
          <AlertDialog
            symbolKey={dialog.alert?.key ?? symbolKey}
            symbolName={dialog.alert?.name ?? name}
            alert={dialog.alert}
            price={dialog.price}
            precision={data?.pricePrecision ?? 2}
            aliases={aliases}
            bench={bench}
            onSaved={() => {
              toast(dialog.alert ? "已保存警报" : "已创建警报");
              setDialog(null);
            }}
            onClose={() => setDialog(null)}
          />
        ))}
      {dialog?.kind === "clear" && (
        <Dialog title="删除所有绘图" onClose={() => setDialog(null)} className="max-w-[360px]">
          <div className="p-4 text-sm">删除这个标的的全部 {chartState.overlays.length} 个绘图？</div>
          <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
            <button type="button" className="btn" onClick={() => setDialog(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" autoFocus onClick={confirmClearDrawings}>
              删除
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}

/** Tall enough that the main pane keeps 45% once each sub pane (plus separator) and the x-axis take theirs. */
function chartMinHeight(subPanes: number): number {
  return Math.max(520, Math.ceil(((SUB_PANE_HEIGHT + 1) * subPanes + 25) / 0.54));
}
