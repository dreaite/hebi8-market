"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { directKey, isCJK, localSearch, mergeResults, type SearchContext, type SearchResult } from "@/lib/search";
import { tickerOf } from "@/lib/symbols";

const NEW_GROUP = "__new__";

export interface PickDetail {
  key: string;
  name: string;
  /** The group chosen on the row; only meaningful when the key is not watched yet */
  group: string;
  /** What was typed, for remembering a Chinese search term as an alias */
  query: string;
  inWatchlist: string | undefined;
  /** Which of `pickActions` was chosen (pick mode); Enter takes the first */
  action?: string;
}

interface SymbolSearchProps {
  /** navigate: open the chart, adding to the watchlist first when needed; pick: hand the key back */
  mode: "navigate" | "pick";
  ctx: SearchContext;
  readOnly?: boolean;
  initialQuery?: string;
  placeholder?: string;
  /** Keys that should not be offered (the chart's own symbol, symbols already compared) */
  exclude?: string[];
  busy?: boolean;
  error?: string | null;
  onPick: (detail: PickDetail) => void;
  onClose: () => void;
  /** pick mode: buttons on the highlighted row, like TradingView's compare dialog */
  pickActions?: { id: string; label: string }[];
}

type Section = "key" | "watchlist" | "common" | "external";
const sectionOf = (r: SearchResult): Section =>
  r.source === "key" ? "key" : r.source === "watchlist" ? "watchlist" : r.source === "alias" || r.source === "wellknown" ? "common" : "external";
const SECTION_LABELS: Record<Section, string> = { key: "", watchlist: "自选", common: "常用", external: "搜索" };

/**
 * One combobox for finding, opening, adding and comparing symbols. The watchlist, aliases and the
 * dictionary match instantly; external sources arrive after a short debounce.
 */
export function SymbolSearch({ mode, ctx, readOnly = false, initialQuery = "", placeholder, exclude = [], busy, error, onPick, onClose, pickActions }: SymbolSearchProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [external, setExternal] = useState<{ query: string; rows: SearchResult[] }>({ query: "", rows: [] });
  const [fetching, setFetching] = useState<string | null>(null);
  // the highlight resets whenever the query changes, without an effect
  const [activeFor, setActiveFor] = useState<{ query: string; index: number }>({ query: "", index: 0 });
  const [groupChoice, setGroupChoice] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState<{ key: string; name: string } | null>(null);

  const trimmed = query.trim();
  const searching = fetching === trimmed;
  const active = activeFor.query === trimmed ? activeFor.index : 0;
  const setActive = (index: number | ((i: number) => number)) =>
    setActiveFor({ query: trimmed, index: typeof index === "function" ? index(active) : index });
  const local = useMemo(() => localSearch(trimmed, ctx), [trimmed, ctx]);
  const rows = useMemo(() => {
    const ext = external.query === trimmed ? external.rows : [];
    const skip = new Set(exclude);
    return mergeResults(local, ext).filter((r) => !skip.has(r.key));
  }, [local, external, trimmed, exclude]);
  const items = useMemo(
    () =>
      rows.map((r, i) => {
        const section = sectionOf(r);
        const header = i === 0 || sectionOf(rows[i - 1]) !== section ? SECTION_LABELS[section] : "";
        return { r, section, header };
      }),
    [rows],
  );

  // external search: 2+ ASCII characters or any CJK, 300ms after the last keystroke
  useEffect(() => {
    const q = trimmed;
    const enough = isCJK(q) ? q.length >= 1 : q.length >= 2;
    if (!enough || directKey(q, ctx.aliases)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setFetching(q);
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<SearchResult[]>) : []))
        .then((list) => setExternal({ query: q, rows: list }))
        .catch(() => undefined)
        .finally(() => setFetching((f) => (f === q ? null : f)));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, ctx.aliases]);

  const groupOptions = [...ctx.groups, NEW_GROUP];
  const chosenGroup = (r: SearchResult) => groupChoice[r.key] ?? r.suggestedGroup;
  const addable = (r: SearchResult) => mode === "navigate" && !readOnly && !r.inWatchlist;

  const pick = (r: SearchResult, group = chosenGroup(r), action = pickActions?.[0]?.id) => {
    if (busy) return;
    if (mode === "navigate" && readOnly && !r.inWatchlist) return;
    if (addable(r) && group === NEW_GROUP) {
      setNewGroup({ key: r.key, name: "" });
      return;
    }
    onPick({ key: r.key, name: r.name, group, query: trimmed, inWatchlist: r.inWatchlist, action });
  };

  const cycleGroup = (r: SearchResult, step: 1 | -1) => {
    const i = groupOptions.indexOf(chosenGroup(r));
    const next = groupOptions[(i + step + groupOptions.length) % groupOptions.length];
    setGroupChoice((g) => ({ ...g, [r.key]: next }));
    if (next === NEW_GROUP) setNewGroup({ key: r.key, name: "" });
    else setNewGroup(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const row = rows[active];
    if (e.key === "ArrowDown" || (e.key === "n" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === "ArrowUp" || (e.key === "p" && e.ctrlKey)) {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (row) pick(row);
    } else if (e.key === "Tab" && row && addable(row)) {
      e.preventDefault();
      cycleGroup(row, e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-opt-${i}`;
  const activeRow = rows[active];
  const needsLogin = mode === "navigate" && readOnly && activeRow && !activeRow.inWatchlist;
  const hint = mode === "pick" ? (pickActions?.[0]?.label ?? "加入对比") : activeRow?.inWatchlist ? "打开" : readOnly ? "需登录" : "添加并打开";

  return (
    <div role="combobox" aria-expanded={rows.length > 0} aria-haspopup="listbox" aria-controls={listId} aria-owns={listId} className="flex flex-col text-xs">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <span className="text-muted" aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "名称、代码、拼音，或 source:ticker"}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeRow ? optionId(active) : undefined}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="h-10 flex-1 bg-transparent text-sm outline-none"
        />
        {activeRow && (
          <span className="hidden text-[11px] text-muted sm:inline">
            Enter {hint}
            {addable(activeRow) && " · Tab 换组"}
          </span>
        )}
      </div>
      <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
        {items.map(({ r, section, header }, i) => {
          const isActive = i === active;
          const ticker = tickerOf(r.key);
          return (
            <li key={r.key} role="presentation">
              {header && <div className="px-3 pt-2 pb-1 text-[11px] text-muted">{header}</div>}
              <div
                id={optionId(i)}
                role="option"
                aria-selected={isActive}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 ${isActive ? "bg-bg" : ""}`}
              >
                <span className="min-w-0 flex-1 truncate">
                  {r.source === "key" && <span className="mr-1 text-muted">使用</span>}
                  <span className="text-sm" title={r.name}>
                    {r.name}
                  </span>
                  {r.name !== ticker && <span className="ml-2 font-mono text-[11px] text-muted">{ticker}</span>}
                  {r.exchange && <span className="ml-2 text-[11px] text-muted">{r.exchange}</span>}
                </span>
                {mode === "pick" && pickActions ? (
                  !isActive ? (
                    r.inWatchlist && <span className="shrink-0 text-[11px] text-muted">{r.inWatchlist}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {pickActions.map((a, ai) => (
                        <button
                          key={a.id}
                          type="button"
                          tabIndex={-1}
                          onClick={() => pick(r, undefined, a.id)}
                          className={`h-[22px] rounded border px-2 text-[11px] ${ai === 0 ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-muted"}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </span>
                  )
                ) : r.inWatchlist ? (
                  <span className="shrink-0 text-[11px] text-muted">
                    {section === "watchlist" ? r.inWatchlist : `已在自选 · ${r.inWatchlist}`}
                  </span>
                ) : addable(r) ? (
                  <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {newGroup?.key === r.key ? (
                      <input
                        value={newGroup.name}
                        onChange={(e) => setNewGroup({ key: r.key, name: e.target.value })}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && newGroup.name.trim()) pick(r, newGroup.name.trim());
                          if (e.key === "Escape") {
                            setNewGroup(null);
                            setGroupChoice((g) => ({ ...g, [r.key]: r.suggestedGroup }));
                            inputRef.current?.focus();
                          }
                        }}
                        placeholder="新分组名 · Enter"
                        autoFocus
                        className="h-[22px] w-28 rounded border border-accent bg-bg px-1.5 text-[11px] outline-none"
                      />
                    ) : !isActive ? (
                      <span className="h-[22px] rounded-full border border-line px-2 text-[11px] leading-[20px] text-muted">{chosenGroup(r) === NEW_GROUP ? "新建分组…" : chosenGroup(r)}</span>
                    ) : (
                      groupOptions.map((g) => {
                        const on = g === chosenGroup(r);
                        return (
                          <button
                            key={g}
                            type="button"
                            tabIndex={-1}
                            onClick={() => {
                              setGroupChoice((c) => ({ ...c, [r.key]: g }));
                              if (g === NEW_GROUP) setNewGroup({ key: r.key, name: "" });
                            }}
                            className={`h-[22px] rounded-full border px-2 text-[11px] ${on ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-muted"}`}
                          >
                            {g === NEW_GROUP ? "新建分组…" : g}
                          </button>
                        );
                      })
                    )}
                  </span>
                ) : (
                  mode === "pick" && isActive && <span className="shrink-0 text-[11px] text-muted">加入对比</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {needsLogin && <div className="border-t border-line px-3 py-2 text-[11px] text-muted">登录后可以添加到自己的列表</div>}
      {(searching || error || (trimmed && rows.length === 0)) && (
        <div className={`border-t border-line px-3 py-2 text-[11px] ${error ? "text-down" : "text-muted"}`}>
          {error ?? (searching ? "搜索中…" : "无结果，可直接输入 source:ticker 或 =表达式")}
        </div>
      )}
      {busy && <div className="border-t border-line px-3 py-2 text-[11px] text-muted">拉取数据中…</div>}
    </div>
  );
}
