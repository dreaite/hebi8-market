"use client";

import { useEffect, useRef } from "react";
import { changeColor, fmtPct, fmtPrice } from "@/lib/format";
import { mergeTarget } from "@/lib/watchlist";
import { IconClose, IconPlus } from "./chart-icons";
import { rowAttrs } from "./use-drag-sort";
import { useWatchlist, type Removable } from "./use-watchlist";
import { DragHandle, FoldButton, GroupMenu, NewGroup } from "./WatchlistParts";

export interface WatchlistGroup {
  name: string;
  items: (Removable & { last: number | null; change: number | null })[];
}

/**
 * TradingView's right-hand watchlist: sections as in hebi8.yaml, foldable, rows and sections
 * dragged into a new order, the open symbol highlighted.「+」opens the search to add symbols, a
 * row's × takes its symbol off the list.
 */
export function WatchlistPanel({
  groups: serverGroups,
  changeLabel,
  current,
  readOnly,
  onPick,
  onAdd,
  onClose,
  className = "",
}: {
  groups: WatchlistGroup[];
  changeLabel: string;
  current: string;
  readOnly: boolean;
  onPick: (key: string) => void;
  /** Open the search in add mode */
  onAdd: () => void;
  onClose: () => void;
  className?: string;
}) {
  const wl = useWatchlist(serverGroups, { readOnly });
  const groups = wl.groups;
  // the × has its own column after the numbers, wide enough for a finger where it always shows
  const end = readOnly ? "pr-3" : "pr-5 [@media(hover:none)]:pr-9";
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  return (
    <aside className={`flex flex-col bg-card text-xs ${className}`} aria-label="自选列表">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line pr-1 pl-3">
        <span className="flex-1 font-medium">自选列表</span>
        {!readOnly && (
          <button type="button" onClick={onAdd} className="tb-btn h-7 min-w-7" title="添加商品" aria-label="添加商品到自选">
            <IconPlus size={16} />
          </button>
        )}
        <button type="button" onClick={onClose} className="tb-btn h-7 min-w-7" title="收起" aria-label="收起自选列表">
          <IconClose size={16} />
        </button>
      </div>
      <div className={`flex h-7 shrink-0 items-center gap-2 border-b border-line pl-4 text-[11px] text-muted ${end}`}>
        <span className="flex-1">标的</span>
        <span className="w-20 text-right">最新价</span>
        <span className="w-14 text-right">{changeLabel}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2" {...wl.drag.rootProps}>
        {groups.map((g) => {
          const open = !wl.collapsed.includes(g.name);
          return (
            <div key={g.name}>
              <div {...rowAttrs(`g:${g.name}`, g.name, wl.drag)} className="relative flex items-center gap-1 pt-2 pr-1 pb-0.5 pl-4 text-[11px] font-medium text-muted">
                {wl.canDrag && (
                  <DragHandle label={`分组「${g.name}」`} onKeyDown={(e) => wl.drag.onHandleKeyDown(e, { kind: "group", name: g.name })} className="absolute top-2 left-0.5 w-3" />
                )}
                <FoldButton name={g.name} open={open} count={g.items.length} onToggle={() => wl.toggle(g.name)} />
                <span className="flex-1" />
                {!readOnly && (
                  <GroupMenu
                    name={g.name}
                    count={g.items.length}
                    mergeInto={mergeTarget(groups, g.name)}
                    onRename={(next) => wl.edit.renameGroup(g.name, next)}
                    onDelete={() => wl.edit.deleteGroup(g.name)}
                  />
                )}
              </div>
              {open && g.items.length === 0 && (
                <div {...rowAttrs(`e:${g.name}`, g.name, wl.drag)} className="py-1.5 pr-3 pl-4 text-[11px] text-muted">
                  这组还没有标的
                </div>
              )}
              {open &&
                g.items.map((item) => {
                  const on = item.key === current;
                  return (
                    <div key={item.key} {...rowAttrs(`s:${item.key}`, g.name, wl.drag)} className={`relative ${on ? "bg-fg/10" : "hover:bg-fg/5"}`}>
                      {wl.canDrag && (
                        <DragHandle label={item.name} onKeyDown={(e) => wl.drag.onHandleKeyDown(e, { kind: "symbol", key: item.key })} className="absolute top-1 left-0.5 z-10 w-3" />
                      )}
                      <button
                        ref={on ? activeRef : undefined}
                        type="button"
                        onClick={() => onPick(item.key)}
                        aria-current={on ? "page" : undefined}
                        className={`flex h-8 w-full items-center gap-2 pl-4 text-left ${end}`}
                      >
                        <span className={`min-w-0 flex-1 truncate text-[13px] ${on ? "font-medium" : ""}`} title={item.name}>
                          {item.name}
                        </span>
                        <span className="tabular w-20 shrink-0 text-right">{item.last != null ? fmtPrice(item.last) : "—"}</span>
                        <span className={`tabular w-14 shrink-0 text-right ${changeColor(item.change)}`}>{fmtPct(item.change, 2)}</span>
                      </button>
                      {!readOnly && (
                        <button
                          type="button"
                          // a press here is not the start of a drag
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => wl.edit.removeSymbol(item, g.name)}
                          aria-label={`从自选移除 ${item.name}`}
                          title="移除"
                          className="row-remove-btn absolute top-1 right-0 flex h-6 w-5 items-center justify-center rounded text-muted hover:text-fg [@media(hover:none)]:top-0 [@media(hover:none)]:h-8 [@media(hover:none)]:w-9"
                        >
                          <IconClose size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
            </div>
          );
        })}
        {!readOnly && <NewGroup onAdd={wl.edit.addGroup} className="mt-3 mr-3 ml-4 h-6" />}
      </div>
      <div aria-live="polite" className="sr-only">
        {wl.drag.announcement}
      </div>
    </aside>
  );
}
