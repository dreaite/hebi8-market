"use client";

import { useCallback, useRef, useState, type KeyboardEvent } from "react";
import { buttonAnchor, useMenu, type MenuAnchor } from "./use-menu";

/** Pieces shared by the overview table and the chart's watchlist panel: grip, fold caret, group menu, new group. */

/** The drag handle: a finger drags from here, the keyboard moves the row with ↑ / ↓. */
export function DragHandle({ label, onKeyDown, className = "" }: { label: string; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void; className?: string }) {
  return (
    <button
      type="button"
      data-dnd-handle=""
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label}：拖动排序，或按 ↑ ↓ 移动`}
      title="拖动排序 · ↑ ↓ 移动"
      className={`dnd-handle flex h-6 w-4 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted hover:text-fg ${className}`}
    >
      <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor" aria-hidden>
        {[2, 7, 12].flatMap((y) => [<circle key={`a${y}`} cx="2" cy={y} r="1.2" />, <circle key={`b${y}`} cx="6" cy={y} r="1.2" />])}
      </svg>
    </button>
  );
}

export function FoldButton({ name, open, count, onToggle }: { name: string; open: boolean; count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-expanded={open}
      title={open ? "收起分组" : "展开分组"}
      className="flex min-w-0 items-center gap-1.5 rounded py-0.5 pr-1 text-left hover:text-fg"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`}>
        <path d="M3 1.5 7 5l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="truncate">{name}</span>
      <span className="tabular shrink-0 font-normal text-muted">{count}</span>
    </button>
  );
}

/** A group's「⋯」: rename, delete (its symbols join the group above, like removing a TradingView section). */
export function GroupMenu({ name, mergeInto, count, onRename, onDelete }: { name: string; mergeInto: string | null; count: number; onRename: (next: string) => void; onDelete: () => void }) {
  const [at, setAt] = useState<MenuAnchor | null>(null);
  const [view, setView] = useState<"root" | "rename">("root");
  const [text, setText] = useState(name);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setAt(null), []);
  useMenu(ref, at, view, close);

  const blocked = count > 0 && !mergeInto;
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={(e) => {
          setView("root");
          setAt(at ? null : buttonAnchor(e.currentTarget));
        }}
        aria-haspopup="menu"
        aria-expanded={Boolean(at)}
        aria-label={`分组「${name}」的操作`}
        className="group-menu-btn h-6 w-6 rounded text-sm leading-none text-muted hover:bg-line hover:text-fg"
      >
        ⋯
      </button>
      {at && (
        <div ref={ref} role="menu" aria-label={`分组「${name}」`} className="menu fixed" style={{ right: "auto" }}>
          {view === "root" && (
            <>
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setText(name);
                  setView("rename");
                }}
              >
                重命名…
              </button>
              <button
                role="menuitem"
                className={`menu-item ${blocked ? "text-muted" : "text-down"}`}
                disabled={blocked}
                title={blocked ? "这是唯一的分组，先移除里面的标的" : undefined}
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                {count > 0 && mergeInto ? `删除分组（标的并入「${mergeInto}」）` : "删除分组"}
              </button>
            </>
          )}
          {view === "rename" && (
            <form
              className="flex flex-col gap-1.5 p-2"
              onSubmit={(e) => {
                e.preventDefault();
                close();
                if (text.trim() && text.trim() !== name) onRename(text.trim());
              }}
            >
              <span className="text-[11px] text-muted">分组名</span>
              <input value={text} onChange={(e) => setText(e.target.value)} className="input w-full" onFocus={(e) => e.currentTarget.select()} />
              <div className="flex justify-end gap-2">
                <button type="button" className="btn" onClick={close}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  确定
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

/** 「+ 新建分组」 at the end of the list, turning into a name field. */
export function NewGroup({ onAdd, className = "" }: { onAdd: (name: string) => void; className?: string }) {
  const [name, setName] = useState<string | null>(null);
  if (name === null) {
    return (
      <button type="button" onClick={() => setName("")} className={`text-[11px] text-muted hover:text-fg ${className}`}>
        + 新建分组
      </button>
    );
  }
  return (
    <form
      className={`flex items-center gap-1.5 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onAdd(name.trim());
        setName(null);
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          setName(null);
        }}
        onBlur={() => !name.trim() && setName(null)}
        placeholder="分组名 · Enter"
        aria-label="新分组名"
        autoFocus
        className="input h-6 w-36 text-xs"
      />
    </form>
  );
}
