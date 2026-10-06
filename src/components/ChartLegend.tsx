"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { changeColor, fmtPct, fmtPrice } from "@/lib/format";
import type { CompareEntry } from "@/lib/vault";
import { IconClose, IconEye, IconGear } from "./chart-icons";
import type { LegendSnapshot } from "./chart-types";

const CANDLE_PANE = "candle_pane";
const EMPTY: LegendSnapshot = { candle: null, paneTops: {}, indicators: [], compares: [] };

export interface LegendStore {
  get: () => LegendSnapshot;
  set: (next: LegendSnapshot) => void;
  subscribe: (listener: () => void) => () => void;
}

/** Live values outside React state, so a crosshair move re-renders only the legend. */
export function createLegendStore(): LegendStore {
  let value = EMPTY;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export interface ChartLegendProps {
  store: LegendStore;
  /** Symbol row: name, then interval · source · benchmark */
  title: string;
  subtitle: string[];
  pricePrecision: number;
  compare: (CompareEntry & { hidden?: boolean })[];
  names: Record<string, string>;
  /** Display label per chart indicator name (built-in name or `F_<id>`) */
  labels: Record<string, string>;
  hiddenIndicators: string[];
  onIndicator: (name: string, action: "toggle" | "settings" | "remove") => void;
  onCompare: (key: string, action: "toggle" | "remove") => void;
  /** Height of the main-pane block, kept free above the candles */
  onMainHeight: (height: number) => void;
}

function RowActions({ hidden, onToggle, onSettings, onRemove }: { hidden: boolean; onToggle: () => void; onSettings?: () => void; onRemove: () => void }) {
  const btn = "flex h-5 w-5 items-center justify-center rounded text-muted hover:bg-fg/10 hover:text-fg";
  return (
    <>
      <button type="button" className={btn} onClick={onToggle} title={hidden ? "显示" : "隐藏"} aria-label={hidden ? "显示" : "隐藏"}>
        <IconEye size={14} off={hidden} />
      </button>
      {onSettings && (
        <button type="button" className={btn} onClick={onSettings} title="设置" aria-label="设置">
          <IconGear size={14} />
        </button>
      )}
      <button type="button" className={btn} onClick={onRemove} title="移除" aria-label="移除">
        <IconClose size={14} />
      </button>
    </>
  );
}

/**
 * One legend line; the action icons show while a mouse is over it, or after a tap on touch screens.
 * Hover is tracked from pointer events rather than CSS :hover, which touch browsers fake on tap and
 * which would put the icons under the finger before the click lands.
 */
function Row({
  id,
  active,
  setActive,
  hover,
  setHover,
  hidden,
  title,
  titleColor,
  params,
  actions,
  onDoubleClick,
  children,
}: {
  id: string;
  active: string | null;
  setActive: (id: string | null) => void;
  hover: string | null;
  setHover: (id: string | null) => void;
  hidden: boolean;
  title: string;
  titleColor?: string;
  params?: string;
  actions: ReactNode;
  onDoubleClick?: () => void;
  children?: ReactNode;
}) {
  const on = active === id || hover === id;
  return (
    <div
      className={`legend-row pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-x-1.5 rounded px-1 ${on ? "bg-card/90" : ""}`}
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(id)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}
      onClick={() => setActive(active === id ? null : id)}
      onDoubleClick={onDoubleClick}
      data-legend={id}
    >
      <span className={`whitespace-nowrap ${hidden ? "text-muted" : "text-fg"}`} style={titleColor && !hidden ? { color: titleColor } : undefined}>
        {title}
        {params && <span className="ml-1 text-muted">{params}</span>}
      </span>
      <span className={`legend-actions items-center gap-0.5 ${on ? "flex" : "hidden"}`} onClick={(e) => e.stopPropagation()}>
        {actions}
      </span>
      {!hidden && children}
    </div>
  );
}

export function ChartLegend({ store, title, subtitle, pricePrecision, compare, names, labels, hiddenIndicators, onIndicator, onCompare, onMainHeight }: ChartLegendProps) {
  const snap = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(onMainHeight);
  useEffect(() => {
    heightRef.current = onMainHeight;
  }, [onMainHeight]);
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => heightRef.current(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const c = snap.candle;
  const change = c && c.prevClose ? c.close - c.prevClose : null;
  const changePct = c && c.prevClose ? c.close / c.prevClose - 1 : null;
  const ohlcColor = c ? (c.close > c.open ? "text-up" : c.close < c.open ? "text-down" : "text-muted") : "text-muted";
  const px = (v: number) => fmtPrice(v, pricePrecision);

  const indicatorRow = (ind: LegendSnapshot["indicators"][number]) => {
    const hidden = hiddenIndicators.includes(ind.name);
    return (
      <Row
        key={ind.name}
        id={ind.name}
        active={active}
        setActive={setActive}
        hover={hover}
        setHover={setHover}
        hidden={hidden}
        title={labels[ind.name] ?? ind.name}
        params={ind.params.length ? ind.params.join(" ") : undefined}
        onDoubleClick={() => onIndicator(ind.name, "settings")}
        actions={
          <RowActions
            hidden={hidden}
            onToggle={() => onIndicator(ind.name, "toggle")}
            onSettings={() => onIndicator(ind.name, "settings")}
            onRemove={() => onIndicator(ind.name, "remove")}
          />
        }
      >
        {ind.values.map((v, i) => (
          <span key={i} className="tabular whitespace-nowrap" style={{ color: v.color }} title={v.title}>
            {v.text}
          </span>
        ))}
      </Row>
    );
  };

  const compareRow = (entry: (typeof compare)[number], slot: number) => {
    const live = snap.compares[slot];
    const hidden = Boolean(entry.hidden);
    return (
      <Row
        key={entry.key}
        id={`cmp:${entry.key}`}
        active={active}
        setActive={setActive}
        hover={hover}
        setHover={setHover}
        hidden={hidden}
        title={names[entry.key] ?? entry.key}
        titleColor={entry.color}
        actions={<RowActions hidden={hidden} onToggle={() => onCompare(entry.key, "toggle")} onRemove={() => onCompare(entry.key, "remove")} />}
      >
        {live?.value != null && <span className="tabular whitespace-nowrap" style={{ color: entry.color }}>{fmtPrice(live.value)}</span>}
        {live?.pct != null && (
          <span className={`tabular whitespace-nowrap ${changeColor(live.pct)}`} title="相对可见区间起点">
            {fmtPct(live.pct, 2)}
          </span>
        )}
      </Row>
    );
  };

  const mainIndicators = snap.indicators.filter((i) => i.paneId === CANDLE_PANE);
  // sub panes in the order KLineChart stacks them
  const subPanes = Object.entries(snap.paneTops)
    .filter(([id]) => id !== CANDLE_PANE)
    .sort((a, b) => a[1] - b[1]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden text-[12px] leading-5" onMouseLeave={() => setActive(null)}>
      <div ref={mainRef} className="absolute top-1 left-1.5 flex max-w-[calc(100%-5rem)] flex-col items-start">
        <div className="legend-row pointer-events-auto flex w-fit max-w-full flex-wrap items-center gap-x-2 rounded px-1">
          <span className="whitespace-nowrap text-[13px] font-medium text-fg">{title}</span>
          {subtitle.length > 0 && <span className="whitespace-nowrap text-muted">{subtitle.join(" · ")}</span>}
          {c && (
            <span className={`tabular flex flex-wrap gap-x-2 ${ohlcColor}`}>
              <span className="whitespace-nowrap">
                <span className="text-muted">开</span>
                {px(c.open)}
              </span>
              <span className="whitespace-nowrap">
                <span className="text-muted">高</span>
                {px(c.high)}
              </span>
              <span className="whitespace-nowrap">
                <span className="text-muted">低</span>
                {px(c.low)}
              </span>
              <span className="whitespace-nowrap">
                <span className="text-muted">收</span>
                {px(c.close)}
              </span>
              {change != null && (
                <span className={`whitespace-nowrap ${changeColor(change)}`}>
                  {change > 0 ? "+" : change < 0 ? "−" : ""}
                  {px(Math.abs(change))} ({fmtPct(changePct, 2)})
                </span>
              )}
            </span>
          )}
        </div>
        {compare.map((entry, slot) => entry.mode === "percent" && compareRow(entry, slot))}
        {mainIndicators.map(indicatorRow)}
      </div>
      {subPanes.map(([paneId, top]) => {
        const rows = snap.indicators.filter((i) => i.paneId === paneId);
        const slot = /^pane_cmp_(\d+)$/.exec(paneId)?.[1];
        const entry = slot !== undefined ? compare[Number(slot)] : undefined;
        if (!rows.length && !entry) return null;
        return (
          <div key={paneId} className="absolute left-1.5 flex max-w-[calc(100%-5rem)] flex-col items-start" style={{ top: top + 2 }}>
            {entry && compareRow(entry, Number(slot))}
            {rows.map(indicatorRow)}
          </div>
        );
      })}
    </div>
  );
}
