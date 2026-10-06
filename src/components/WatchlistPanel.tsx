"use client";

import { useEffect, useRef } from "react";
import { changeColor, fmtPct, fmtPrice } from "@/lib/format";
import { IconClose } from "./chart-icons";

export interface WatchlistGroup {
  name: string;
  items: { key: string; name: string; last: number | null; change: number | null }[];
}

/** TradingView's right-hand watchlist: grouped as in hebi8.yaml, the open symbol highlighted. */
export function WatchlistPanel({
  groups,
  changeLabel,
  current,
  onPick,
  onClose,
  className = "",
}: {
  groups: WatchlistGroup[];
  changeLabel: string;
  current: string;
  onPick: (key: string) => void;
  onClose: () => void;
  className?: string;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <aside className={`flex flex-col bg-card text-xs ${className}`} aria-label="自选列表">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3">
        <span className="flex-1 font-medium">自选列表</span>
        <button type="button" onClick={onClose} className="tb-btn h-7 min-w-7" title="收起" aria-label="收起自选列表">
          <IconClose size={16} />
        </button>
      </div>
      <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-3 text-[11px] text-muted">
        <span className="flex-1">标的</span>
        <span className="w-20 text-right">最新价</span>
        <span className="w-14 text-right">{changeLabel}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.map((g) => (
          <div key={g.name}>
            <div className="px-3 pt-2.5 pb-1 text-[11px] font-medium text-muted">{g.name}</div>
            {g.items.map((item) => {
              const on = item.key === current;
              return (
                <button
                  key={item.key}
                  ref={on ? activeRef : undefined}
                  type="button"
                  onClick={() => onPick(item.key)}
                  aria-current={on ? "page" : undefined}
                  className={`flex h-8 w-full items-center gap-2 px-3 text-left ${on ? "bg-fg/10" : "hover:bg-fg/5"}`}
                >
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${on ? "font-medium" : ""}`} title={item.name}>
                    {item.name}
                  </span>
                  <span className="tabular w-20 shrink-0 text-right">{item.last != null ? fmtPrice(item.last) : "—"}</span>
                  <span className={`tabular w-14 shrink-0 text-right ${changeColor(item.change)}`}>{fmtPct(item.change, 2)}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}
