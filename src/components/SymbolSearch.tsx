"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { analyzeExpression, directKey, isCJK, isExpression, localSearch, mergeResults, suggestGroup, type SearchContext, type SearchResult } from "@/lib/search";
import { isSynthetic, tickerOf } from "@/lib/symbols";
import { synthOperand } from "@/lib/synth";
import { displayName } from "@/lib/wellknown";

const NEW_GROUP = "__new__";

export interface PickDetail {
  key: string;
  name: string;
  /** The group chosen on the row; only meaningful when the key is not watched yet */
  group: string;
  /** What was typed, for remembering a Chinese search term as an alias */
  query: string;
  inWatchlist: string | undefined;
  /** navigate / add mode: `open` the chart or `add` to the watchlist; pick mode: which of `pickActions` (Enter takes the first) */
  action?: string;
}

export type SearchMode = "navigate" | "add" | "pick";

interface SymbolSearchProps {
  /**
   * navigate: Enter opens the chart (like TradingView, opening never adds); the row's「+」or
   * Shift+Enter adds. add: Enter adds (the watchlist's「+」). pick: hand the key back.
   */
  mode: SearchMode;
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
 * One combobox for finding, opening, adding and comparing symbols, as in TradingView: choosing a
 * result opens it, adding to the watchlist is its own action. The watchlist, aliases and the
 * dictionary match instantly; external sources arrive after a short debounce.
 *
 * A spread (`AAPL/MSFT`) is searched operand by operand, like TradingView: the results are for
 * the operand at the caret and choosing one replaces it; the expression itself is the top row.
 */
export function SymbolSearch({ mode, ctx, readOnly = false, initialQuery = "", placeholder, exclude = [], busy, error, onPick, onClose, pickActions }: SymbolSearchProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [caret, setCaret] = useState(initialQuery.length);
  // where the caret goes after an operand is replaced
  const caretTo = useRef<number | null>(null);
  const [external, setExternal] = useState<{ query: string; rows: SearchResult[] }>({ query: "", rows: [] });
  const [fetching, setFetching] = useState<string | null>(null);
  // the highlight resets whenever the query changes, without an effect
  const [activeFor, setActiveFor] = useState<{ query: string; index: number }>({ query: "", index: 0 });
  const [groupChoice, setGroupChoice] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState<{ key: string; name: string } | null>(null);

  const trimmed = query.trim();
  const expr = useMemo(() => (isExpression(trimmed) ? analyzeExpression(query, caret, ctx.aliases) : null), [trimmed, query, caret, ctx.aliases]);
  // what the sources are asked: the whole query, or the operand at the caret
  const term = expr ? (expr.active?.text ?? "") : trimmed;
  const searching = fetching === term;
  const active = activeFor.query === trimmed ? activeFor.index : 0;
  const setActive = (index: number | ((i: number) => number)) =>
    setActiveFor({ query: trimmed, index: typeof index === "function" ? index(active) : index });
  const local = useMemo(() => localSearch(term, ctx), [term, ctx]);
  const rows = useMemo(() => {
    const merged = mergeResults(local, external.query === term ? external.rows : []);
    const skip = new Set(exclude);
    if (!expr) return merged.filter((r) => !skip.has(r.key));
    const operands = merged.filter((r) => r.source !== "key" && !isSynthetic(r.key));
    if (!expr.key || skip.has(expr.key)) return operands;
    const w = ctx.watchlist.find((x) => x.key === expr.key);
    const row: SearchResult = { key: expr.key, name: w?.name ?? displayName(expr.key), source: "key", inWatchlist: w?.group, suggestedGroup: w?.group ?? suggestGroup(expr.key, undefined, ctx.groups) };
    return [row, ...operands];
  }, [local, external, term, exclude, expr, ctx]);
  const items = useMemo(
    () =>
      rows.map((r, i) => {
        const section = sectionOf(r);
        const header = i === 0 || sectionOf(rows[i - 1]) !== section ? SECTION_LABELS[section] : "";
        return { r, section, header };
      }),
    [rows],
  );

  useLayoutEffect(() => {
    if (caretTo.current === null) return;
    inputRef.current?.setSelectionRange(caretTo.current, caretTo.current);
    caretTo.current = null;
  }, [query]);

  // external search: 2+ ASCII characters or any CJK, 300ms after the last keystroke
  useEffect(() => {
    const q = term;
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
  }, [term, ctx.aliases]);

  const groupOptions = [...ctx.groups, NEW_GROUP];
  const chosenGroup = (r: SearchResult) => groupChoice[r.key] ?? r.suggestedGroup;
  // from the list as it is now, so a row added a moment ago says so
  const watchedIn = useMemo(() => new Map(ctx.watchlist.map((w) => [w.key, w.group])), [ctx.watchlist]);
  const groupOf = (r: SearchResult) => watchedIn.get(r.key);
  /** A result for the operand at the caret, not a symbol to open */
  const replaces = (r: SearchResult) => expr !== null && !isSynthetic(r.key);
  const addable = (r: SearchResult) => !replaces(r) && mode !== "pick" && !readOnly && !groupOf(r);

  // an expression's text is no search term worth keeping as an alias
  const detail = (r: SearchResult, group: string, action: string | undefined): PickDetail => ({ key: r.key, name: r.name, group, query: expr ? "" : trimmed, inWatchlist: groupOf(r), action });

  /** The operand at the caret becomes the chosen key; the search stays open for the next one */
  const replace = (r: SearchResult) => {
    const op = expr?.active;
    if (!op) return;
    const text = synthOperand(r.key);
    caretTo.current = op.start + text.length;
    setQuery(query.slice(0, op.start) + text + query.slice(op.end));
    setCaret(caretTo.current);
  };

  /** Enter or a click: open the chart, add (add mode), or the first pick action */
  const pick = (r: SearchResult, action = pickActions?.[0]?.id) => {
    if (busy) return;
    if (replaces(r)) return replace(r);
    if (mode === "add") return add(r);
    if (mode === "navigate" && readOnly && !groupOf(r)) return;
    onPick(detail(r, chosenGroup(r), mode === "navigate" ? "open" : action));
  };

  /** The row's「+」, Shift+Enter, or Enter in add mode: into the chosen group */
  const add = (r: SearchResult, group = chosenGroup(r)) => {
    if (replaces(r)) return replace(r);
    if (busy || !addable(r)) return;
    if (group === NEW_GROUP) {
      setNewGroup({ key: r.key, name: "" });
      return;
    }
    onPick(detail(r, group, "add"));
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
      if (row && e.shiftKey && mode === "navigate") add(row);
      else if (row) pick(row);
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
  const needsLogin = mode !== "pick" && readOnly && activeRow && !replaces(activeRow) && !groupOf(activeRow);
  const hint = !activeRow
    ? ""
    : replaces(activeRow)
      ? `Enter 替换「${expr?.active?.text}」`
      : mode === "pick"
        ? `Enter ${pickActions?.[0]?.label ?? "加入对比"}`
        : mode === "add"
          ? addable(activeRow)
            ? "Enter 加入自选 · Tab 换组"
            : groupOf(activeRow)
              ? "已在自选"
              : "需登录"
          : groupOf(activeRow) || readOnly
            ? groupOf(activeRow)
              ? "Enter 打开"
              : "需登录"
            : "Enter 打开 · Shift+Enter 加入自选 · Tab 换组";

  return (
    <div role="combobox" aria-expanded={rows.length > 0} aria-haspopup="listbox" aria-controls={listId} aria-owns={listId} className="flex flex-col text-xs">
      <div className="flex items-center gap-2 border-b border-line px-3">
        <span className="text-muted" aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCaret(e.target.selectionStart ?? e.target.value.length);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "名称、代码、拼音、source:ticker，或 AAPL/MSFT"}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-activedescendant={activeRow ? optionId(active) : undefined}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="h-10 flex-1 bg-transparent text-sm outline-none"
        />
        {hint && <span className="hidden text-[11px] text-muted sm:inline">{hint}</span>}
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
                {replaces(r) ? (
                  isActive && <span className="shrink-0 text-[11px] text-muted">替换</span>
                ) : mode === "pick" && pickActions ? (
                  !isActive ? (
                    groupOf(r) && <span className="shrink-0 text-[11px] text-muted">{groupOf(r)}</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {pickActions.map((a, ai) => (
                        <button
                          key={a.id}
                          type="button"
                          tabIndex={-1}
                          onClick={() => pick(r, a.id)}
                          className={`h-[22px] rounded border px-2 text-[11px] ${ai === 0 ? "border-fg bg-fg text-bg" : "border-line text-fg hover:border-muted"}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </span>
                  )
                ) : groupOf(r) ? (
                  <span className="shrink-0 text-[11px] text-muted">{section === "watchlist" ? groupOf(r) : `已在自选 · ${groupOf(r)}`}</span>
                ) : addable(r) ? (
                  <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {newGroup?.key === r.key ? (
                      <input
                        value={newGroup.name}
                        onChange={(e) => setNewGroup({ key: r.key, name: e.target.value })}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter" && newGroup.name.trim()) add(r, newGroup.name.trim());
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
                    ) : (
                      isActive &&
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
                            aria-pressed={on}
                            className={`h-[22px] rounded-full border px-2 text-[11px] ${on ? "border-fg bg-fg text-bg" : "border-line text-muted hover:border-muted"}`}
                          >
                            {g === NEW_GROUP ? "新建分组…" : g}
                          </button>
                        );
                      })
                    )}
                    {newGroup?.key !== r.key && (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => add(r)}
                        aria-label={`加入自选「${chosenGroup(r) === NEW_GROUP ? "新分组" : chosenGroup(r)}」`}
                        title={`加入自选 · ${chosenGroup(r) === NEW_GROUP ? "新分组" : chosenGroup(r)}${mode === "navigate" ? "（Shift+Enter）" : "（Enter）"}`}
                        className={`flex h-[22px] w-[22px] items-center justify-center rounded border text-sm leading-none ${isActive ? "border-fg text-fg hover:bg-fg hover:text-bg" : "border-transparent text-muted"}`}
                      >
                        +
                      </button>
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
      {needsLogin && <div className="border-t border-line px-3 py-2 text-[11px] text-muted">登录后可以打开不在列表里的标的，并加入自己的自选</div>}
      {(searching || error || expr?.error || (trimmed && rows.length === 0)) && (
        <div className={`border-t border-line px-3 py-2 text-[11px] ${error ? "text-down" : "text-muted"}`}>
          {error ?? (searching ? "搜索中…" : expr?.error ? `表达式：${expr.error}` : "无结果，可直接输入 source:ticker 或 AAPL/MSFT 这样的表达式")}
        </div>
      )}
      {busy && <div className="border-t border-line px-3 py-2 text-[11px] text-muted">拉取数据中…</div>}
    </div>
  );
}
