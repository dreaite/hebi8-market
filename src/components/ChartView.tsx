"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ENABLED, INDICATORS } from "@/indicators/catalog";
import type { BarsResponse } from "@/lib/api-types";
import { changeColor, fmtAgo, fmtPct, fmtPrice } from "@/lib/format";
import { usePref } from "@/lib/prefs";
import { SOURCE_LABELS, TIMEFRAMES, type Timeframe } from "@/lib/symbols";
import { IndicatorBar } from "./IndicatorBar";
import type { IndicatorSpec } from "./KChart";

const KChart = dynamic(() => import("./KChart").then((m) => m.KChart), { ssr: false });

const TF_LABELS: Record<Timeframe, string> = { D: "日", W: "周", M: "月" };
const PERIOD_CHANGE_LABELS: Record<Timeframe, string> = { D: "今日", W: "本周", M: "本月" };

type ParamOverrides = Record<Timeframe, Record<string, number[]>>;
const NO_OVERRIDES: ParamOverrides = { D: {}, W: {}, M: {} };

export function ChartView({ symbolKey }: { symbolKey: string }) {
  const [tf, setTf, tfLoaded] = usePref<Timeframe>("tf", "W");
  const [log, setLog] = usePref("log", true);
  const [enabled, setEnabled] = usePref<string[]>("indicators", DEFAULT_ENABLED);
  const [overrides, setOverrides] = usePref<ParamOverrides>("params", NO_OVERRIDES);

  const [data, setData] = useState<BarsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const forceRefresh = useRef(false);

  useEffect(() => {
    if (!tfLoaded) return;
    const controller = new AbortController();
    const refresh = forceRefresh.current;
    forceRefresh.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for the fetch below
    setLoading(true);
    fetch(`/api/bars?key=${encodeURIComponent(symbolKey)}&tf=${tf}${refresh ? "&refresh=1" : ""}`, {
      signal: controller.signal,
      cache: "no-store",
    })
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
  }, [symbolKey, tf, tfLoaded, reloadTick]);

  const tfOverrides = useMemo(() => overrides[tf] ?? {}, [overrides, tf]);
  const params = useMemo(
    () => Object.fromEntries(INDICATORS.map((d) => [d.name, tfOverrides[d.name] ?? d.params[tf]])),
    [tf, tfOverrides],
  );
  const hasBenchmark = Boolean(data?.benchmark);
  const specs: IndicatorSpec[] = useMemo(
    () =>
      INDICATORS.filter((d) => enabled.includes(d.name) && (!d.needsBenchmark || hasBenchmark)).map((d) => ({
        name: d.name,
        pane: d.pane,
        calcParams: params[d.name],
      })),
    [enabled, hasBenchmark, params],
  );

  const toggle = (name: string) =>
    setEnabled(enabled.includes(name) ? enabled.filter((n) => n !== name) : [...enabled, name]);
  const setParams = (name: string, value: number[] | null) => {
    const next = { ...tfOverrides };
    if (value) next[name] = value;
    else delete next[name];
    setOverrides({ ...overrides, [tf]: next });
  };

  const bars = data?.bars;
  const last = bars?.at(-1);
  const prev = bars && bars.length > 1 ? bars[bars.length - 2] : undefined;
  const periodChange = last && prev ? last.close / prev.close - 1 : null;
  const meta = data?.symbol;

  return (
    <main className="flex w-full flex-1 flex-col px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="text-xs text-muted hover:text-fg">
            ← 总览
          </Link>
          <h1 className="text-base font-medium">{meta?.name ?? symbolKey}</h1>
          {meta && (
            <span className="font-mono text-[11px] text-muted">
              {meta.ticker} · {SOURCE_LABELS[meta.source]}
              {data?.benchmark && ` · 基准 ${data.benchmark.name}`}
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
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex rounded-md border border-line p-0.5">
            {TIMEFRAMES.map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`rounded px-3 py-0.5 ${t === tf ? "bg-fg text-bg" : "text-muted hover:text-fg"}`}
              >
                {TF_LABELS[t]}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-muted">
            <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} className="accent-current" />
            对数坐标
          </label>
          <button
            onClick={() => {
              forceRefresh.current = true;
              setReloadTick((n) => n + 1);
            }}
            disabled={loading}
            className="text-muted hover:text-fg disabled:opacity-50"
            title={meta ? fmtAgo(meta.syncedAt) : undefined}
          >
            {loading ? "加载中…" : "刷新"}
          </button>
        </div>
      </div>

      <div className="mb-3">
        <IndicatorBar
          enabled={enabled}
          params={params}
          overridden={new Set(Object.keys(tfOverrides))}
          hasBenchmark={hasBenchmark}
          onToggle={toggle}
          onParams={setParams}
        />
      </div>

      {(error || data?.error) && (
        <p className="mb-2 text-xs text-down">
          {error ? `加载失败：${error}` : `刷新失败，显示的是缓存数据：${data?.error}`}
        </p>
      )}

      <div className="relative min-h-[520px] flex-1 rounded-lg border border-line bg-card">
        <div className="absolute inset-0 p-1">
          <KChart
            symbolKey={symbolKey}
            tf={tf}
            bars={bars ?? null}
            pricePrecision={data?.pricePrecision ?? 2}
            log={log}
            indicators={specs}
          />
        </div>
      </div>
    </main>
  );
}
