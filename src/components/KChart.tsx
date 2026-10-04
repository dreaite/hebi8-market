"use client";

import { useEffect, useRef } from "react";
import { dispose, init, registerIndicator, type Chart, type DeepPartial, type KLineData, type Styles } from "klinecharts";
import { customIndicators } from "@/indicators/custom";
import { formulaTemplate, isFormulaIndicator, type FormulaDef } from "@/indicators/formula-indicators";
import type { ChartBar } from "@/lib/api-types";
import { UPDOWN_EVENT } from "@/lib/prefs";
import type { Timeframe } from "@/lib/symbols";

export interface IndicatorSpec {
  name: string;
  pane: "main" | "sub";
  calcParams: number[];
}

export type ChartStyle = "candle_solid" | "candle_up_stroke" | "ohlc" | "area";

interface KChartProps {
  symbolKey: string;
  tf: Timeframe;
  bars: ChartBar[] | null;
  pricePrecision: number;
  log: boolean;
  chartStyle: ChartStyle;
  indicators: IndicatorSpec[];
  /** Templates for the formula indicators referenced by `indicators` */
  formulas: FormulaDef[];
}

const PERIODS = {
  D: { type: "day", span: 1 },
  W: { type: "week", span: 1 },
  M: { type: "month", span: 1 },
} as const;

/** How many bars the initial view should fit: ~2 years of days, ~5 years of weeks, all months. */
const INITIAL_BARS: Record<Timeframe, number> = { D: 500, W: 260, M: Infinity };

function initialBarSpace(width: number, tf: Timeframe, total: number): number {
  const plotWidth = Math.max(200, width - 80); // minus the y-axis
  return Math.min(12, Math.max(1.5, plotWidth / Math.min(total, INITIAL_BARS[tf])));
}

const CANDLE_PANE = "candle_pane";

let customRegistered = false;
function registerCustomIndicators() {
  if (customRegistered) return;
  customIndicators.forEach((template) => registerIndicator(template as Parameters<typeof registerIndicator>[0]));
  customRegistered = true;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

function applyTheme(chart: Chart, style: ChartStyle) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const up = cssVar("--up");
  const down = cssVar("--down");
  const muted = cssVar("--muted");
  const line = cssVar("--line");
  const accent = cssVar("--accent");
  const axis = { axisLine: { color: line }, tickLine: { color: line }, tickText: { color: muted } };
  const overrides: DeepPartial<Styles> = {
    grid: { horizontal: { color: cssVar("--chart-grid") }, vertical: { show: false } },
    candle: {
      type: style,
      area: {
        lineColor: accent,
        lineSize: 1.5,
        backgroundColor: [
          { offset: 0, color: withAlpha(accent, 0.01) },
          { offset: 1, color: withAlpha(accent, 0.16) },
        ],
      },
      bar: {
        upColor: up,
        downColor: down,
        noChangeColor: muted,
        upBorderColor: up,
        downBorderColor: down,
        noChangeBorderColor: muted,
        upWickColor: up,
        downWickColor: down,
        noChangeWickColor: muted,
      },
      priceMark: { last: { upColor: up, downColor: down, noChangeColor: muted } },
      // The page header already names the symbol and timeframe.
      tooltip: { title: { show: false } },
    },
    indicator: {
      bars: [{ upColor: withAlpha(up, 0.55), downColor: withAlpha(down, 0.55), noChangeColor: muted }],
    },
    xAxis: axis,
    yAxis: axis,
    separator: { color: line },
  };
  chart.setStyles(dark ? "dark" : "light");
  chart.setStyles(overrides);
}

export function KChart({ symbolKey, tf, bars, pricePrecision, log, chartStyle, indicators, formulas }: KChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const barsRef = useRef<ChartBar[]>([]);
  const styleRef = useRef(chartStyle);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    registerCustomIndicators();
    const chart = init(el, { locale: "zh-CN", timezone: "UTC" });
    if (!chart) return;
    chartRef.current = chart;
    applyTheme(chart, styleRef.current);
    // The full history arrives in one response, so there is never more to load.
    chart.setDataLoader({
      getBars: ({ type, callback }) => callback(type === "init" ? (barsRef.current as KLineData[]) : [], false),
    });

    const retheme = () => applyTheme(chart, styleRef.current);
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", retheme);
    window.addEventListener(UPDOWN_EVENT, retheme);
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(el);

    return () => {
      media.removeEventListener("change", retheme);
      window.removeEventListener(UPDOWN_EVENT, retheme);
      resize.disconnect();
      dispose(el);
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !bars) return;
    barsRef.current = bars;
    chart.setBarSpace(initialBarSpace(containerRef.current?.clientWidth ?? 1000, tf, bars.length));
    // Both calls reset the data and pull it from barsRef through the loader above.
    chart.setSymbol({ ticker: symbolKey, pricePrecision, volumePrecision: 0 });
    chart.setPeriod(PERIODS[tf]);
  }, [bars, symbolKey, tf, pricePrecision]);

  useEffect(() => {
    styleRef.current = chartStyle;
    if (chartRef.current) applyTheme(chartRef.current, chartStyle);
  }, [chartStyle]);

  const indicatorKey = JSON.stringify({ indicators, formulas });
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = JSON.parse(indicatorKey) as { indicators: IndicatorSpec[]; formulas: FormulaDef[] };
    // Re-registering under the same name swaps in the edited formula.
    const available = new Set<string>();
    for (const def of current.formulas) {
      const template = formulaTemplate(def);
      if (!template) continue;
      registerIndicator(template as Parameters<typeof registerIndicator>[0]);
      available.add(template.name);
    }
    chart.removeIndicator();
    for (const spec of current.indicators) {
      if (isFormulaIndicator(spec.name) && !available.has(spec.name)) continue;
      if (spec.pane === "main") {
        chart.createIndicator({ name: spec.name, calcParams: spec.calcParams, paneId: CANDLE_PANE }, true);
      } else {
        chart.createIndicator({ name: spec.name, calcParams: spec.calcParams, paneId: `pane_${spec.name}` });
      }
    }
  }, [indicatorKey]);

  useEffect(() => {
    chartRef.current?.overrideYAxis({ paneId: CANDLE_PANE, name: log ? "logarithm" : "normal" });
  }, [log]);

  return <div ref={containerRef} className="h-full w-full" />;
}
