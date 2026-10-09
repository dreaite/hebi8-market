"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { analyzeExpression, directKey, insertText, isCJK, isExpression, localSearch, logoUrl, mergeResults, sameSpread, suggestGroup, typeLabel, type SearchContext, type SearchResult } from "@/lib/search";
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

/** TradingView's spread buttons; `-` gets spaces so it is never read as part of a ticker like BRK-B */
const OPERATORS = [
  { text: "/", label: "÷", title: "除，比价：BTC/SPX" },
  { text: "*", label: "×", title: "乘：2*SPY" },
  { text: "+", label: "+", title: "加：SPY+QQQ" },
  { text: " - ", label: "−", title: "减：SPY - QQQ" },
  { text: "^", label: "^", title: "乘方：SPY^2" },
  { text: "(", label: "(", title: "左括号：2*(SPY - QQQ)" },
  { text: ")", label: ")", title: "右括号" },
];
const EXAMPLES = ["BTC/GOLD", "SPY/QQQ", "2*(SPY - QQQ)"];

/** The instrument's round logo, or its first letter when there is none or it does not load. Remount it (`key`) for another logo. */
function SymbolLogo({ logo, ticker }: { logo?: string; ticker: string }) {
  const [failed, setFailed] = useState(false);
  if (!logo || failed) {
    const letter = ticker.replace(/^[=^]/, "").replace(/^[A-Z_]+:/i, "").charAt(0).toUpperCase();
    return (
      <span aria-hidden className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-line text-[10px] text-muted">
        {letter}
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- TradingView's SVG logos, nothing to optimise
  return <img src={logoUrl(logo)} alt="" width={18} height={18} loading="lazy" onError={() => setFailed(true)} className="h-[18px] w-[18px] shrink-0 rounded-full" />;
}

/**
 * Like TradingView's search, on the right: the type, then the exchange name and its small logo.
 * A phone keeps only the logo, unless there is none or it does not load. Remount it (`key`) for another logo.
 */
function RowMeta({ type, exchange, logo }: { type?: string; exchange?: string; logo?: string }) {
  const [failed, setFailed] = useState(false);
  const showLogo = logo && !failed;
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted">
      {type && <span>{type}</span>}
      {exchange && <span className={`max-w-[9rem] truncate ${showLogo ? "max-sm:hidden" : ""}`}>{exchange}</span>}
      {showLogo && (
        // eslint-disable-next-line @next/next/no-img-element -- TradingView's SVG logos, nothing to optimise
        <img src={logoUrl(logo)} alt="" width={14} height={14} loading="lazy" onError={() => setFailed(true)} className="h-[14px] w-[14px] shrink-0 rounded-full" />
      )}
    </span>
  );
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
  // external results by search text, kept while the box is open: an expression's operands need theirs to resolve
  const [found, setFound] = useState<Map<string, SearchResult[]>>(new Map());
  const [fetching, setFetching] = useState<string[]>([]);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  // the highlight resets whenever the list changes (query, or the operand searched), without an effect
  const [activeFor, setActiveFor] = useState<{ query: string; index: number }>({ query: "", index: 0 });
  const [groupChoice, setGroupChoice] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState<{ key: string; name: string } | null>(null);

  const trimmed = query.trim();
  const expr = useMemo(() => (isExpression(trimmed) ? analyzeExpression(query, caret, ctx.aliases, (t) => found.get(t)) : null), [trimmed, query, caret, ctx.aliases, found]);
  // what the list is for: the whole query, or the operand at the caret
  const term = expr ? (expr.active?.text ?? "") : trimmed;
  const searching = fetching.includes(term);
  // the sources are asked about the term (2+ ASCII characters or any CJK) and about every operand
  // that only a search can turn into a key
  const enough = isCJK(term) ? term.length >= 1 : term.length >= 2;
  const lookups = [...new Set([...(enough && !directKey(term, ctx.aliases) ? [term] : []), ...(expr?.operands.filter((o) => o.pending).map((o) => o.text) ?? [])])];
  const lookupKey = lookups.filter((q) => !found.has(q)).join("\n");
  const listFor = `${trimmed}\n${term}`;
  const active = activeFor.query === listFor ? activeFor.index : 0;
  const setActive = (index: number | ((i: number) => number)) =>
    setActiveFor({ query: listFor, index: typeof index === "function" ? index(active) : index });
  const local = useMemo(() => localSearch(term, ctx), [term, ctx]);
  const rows = useMemo(() => {
    const merged = mergeResults(local, found.get(term) ?? []);
    const skip = new Set(exclude);
    if (!expr) return merged.filter((r) => !skip.has(r.key));
    // an operand typed as an alias or key keeps its own row, so it can be chosen again
    const operands = merged.filter((r) => !isSynthetic(r.key));
    if (!expr.key || sameSpread(expr.key, exclude, ctx.aliases)) return operands;
    // a spread already watched under another spelling (`=BTC/GOLD`) is that entry, not a new one
    const watchedKey = sameSpread(expr.key, ctx.watchlist.map((x) => x.key), ctx.aliases);
    const w = ctx.watchlist.find((x) => x.key === watchedKey);
    const key = w?.key ?? expr.key;
    const row: SearchResult = { key, name: w?.name ?? displayName(key), source: "key", inWatchlist: w?.group, suggestedGroup: w?.group ?? suggestGroup(key, undefined, ctx.groups) };
    return [row, ...operands];
  }, [local, found, term, exclude, expr, ctx]);
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

  // external search, 300ms after the last keystroke
  useEffect(() => {
    if (!lookupKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      for (const q of lookupKey.split("\n")) {
        setFetching((f) => [...f, q]);
        fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json() as Promise<SearchResult[]>;
          })
          .then((list) => setFound((f) => new Map(f).set(q, list)))
          .catch((err: Error) => {
            if (err.name === "AbortError") return;
            // nothing found for it now; the status line says the search failed rather than "no results"
            setFound((f) => new Map(f).set(q, []));
            setFailed((f) => new Set(f).add(q));
          })
          .finally(() => setFetching((f) => f.filter((x) => x !== q)));
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [lookupKey]);

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

  /** Typed at the caret, over the selection if there is one; the input keeps focus */
  const typeAt = (text: string, start: number, end: number) => {
    const next = insertText(query, start, end, text);
    caretTo.current = next.caret;
    setQuery(next.text);
    setCaret(next.caret);
  };
  const typeOperator = (text: string) => {
    const input = inputRef.current!;
    typeAt(text, input.selectionStart ?? query.length, input.selectionEnd ?? query.length);
  };

  /** The operand at the caret becomes the chosen key; the search stays open for the next one */
  const replace = (r: SearchResult) => {
    const op = expr?.active;
    if (!op) return;
    const text = synthOperand(r.key, ctx.aliases);
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
      <div className="flex flex-wrap items-center gap-x-2 border-b border-line px-3">
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
          className="h-10 min-w-0 flex-[1_1_10rem] bg-transparent text-sm outline-none"
        />
        {/* on a narrow screen the buttons wrap under the input rather than squeezing it */}
        <span className="flex shrink-0 gap-1 py-1.5">
          {OPERATORS.map((op) => (
            <button
              key={op.text}
              type="button"
              tabIndex={-1}
              title={op.title}
              aria-label={op.title}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => typeOperator(op.text)}
              className="h-[22px] min-w-[22px] rounded border border-line px-1 text-[12px] leading-none text-muted hover:border-muted hover:text-fg"
            >
              {op.label}
            </button>
          ))}
        </span>
        {/* the hint, not the buttons, goes to its own line when the row is full */}
        {hint && <span className="ml-auto hidden pb-1.5 text-[11px] text-muted sm:inline">{hint}</span>}
      </div>
      {!trimmed && (
        <div className="px-3 pt-2 text-[11px] text-muted">
          比价试试：
          {EXAMPLES.map((ex, i) => (
            <span key={ex}>
              {i > 0 && " · "}
              <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => typeAt(ex, 0, query.length)} className="hover:text-fg hover:underline">
                {ex}
              </button>
            </span>
          ))}
        </div>
      )}
      <ul id={listId} role="listbox" className="max-h-[60vh] overflow-y-auto py-1">
        {items.map(({ r, section, header }, i) => {
          const isActive = i === active;
          const ticker = tickerOf(r.key);
          // a group named like the type (比价, 加密, 数据) already says it
          const type = typeLabel(r) === groupOf(r) ? undefined : typeLabel(r);
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
                className={`flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5 ${isActive ? "bg-bg" : ""}`}
              >
                <SymbolLogo key={r.logo} logo={r.logo} ticker={ticker} />
                {/* the name gives way down to 4rem, the code never; past that the row's buttons wrap to a second line */}
                <span className="flex min-w-min flex-1 items-baseline gap-2">
                  <span className="w-16 max-w-fit grow truncate">
                    {r.source === "key" && !replaces(r) && <span className="mr-1 text-muted">使用</span>}
                    <span className="text-sm" title={r.name}>
                      {r.name}
                    </span>
                  </span>
                  {r.name !== ticker && <span className="max-w-full shrink-0 truncate font-mono text-[11px] text-muted">{ticker}</span>}
                </span>
                {(type || r.exchange) && <RowMeta key={r.sourceLogo} type={type} exchange={r.exchange} logo={r.sourceLogo} />}
                {replaces(r) ? (
                  isActive && <span className="shrink-0 text-[11px] text-muted">替换</span>
                ) : mode === "pick" && pickActions ? (
                  !isActive ? (
                    groupOf(r) && <span className="shrink-0 text-[11px] text-muted">{groupOf(r)}</span>
                  ) : (
                    <span className="ml-auto flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                  // on a phone the highlighted row's group chips take a line of their own, so the name stays readable
                  <span className={`ml-auto flex shrink-0 flex-wrap items-center gap-1 ${isActive ? "max-sm:basis-full" : ""}`} onClick={(e) => e.stopPropagation()}>
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
      {(searching || error || failed.has(term) || expr?.error || (trimmed && rows.length === 0)) && (
        <div className={`border-t border-line px-3 py-2 text-[11px] ${error ? "text-down" : "text-muted"}`}>
          {error ?? (searching ? "搜索中…" : failed.has(term) ? "搜索失败，稍后再试" : expr?.error ? `表达式：${expr.error}` : "无结果，可直接输入 source:ticker 或 AAPL/MSFT 这样的表达式")}
        </div>
      )}
      {busy && <div className="border-t border-line px-3 py-2 text-[11px] text-muted">拉取数据中…</div>}
    </div>
  );
}
