"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { addSymbol, moveSymbol, refresh, removeSymbol, renameSymbol, setBench, setPeriods, setUpdown } from "@/app/actions";
import type { UpDown } from "@/lib/config";
import { changeColor, fmtAgo, fmtPct, fmtPrice } from "@/lib/format";
import { CHANGE_PERIODS, MAX_PERIODS, type ChangePeriod } from "@/lib/periods";
import type { Stats } from "@/lib/stats";
import { SOURCE_LABELS, type Source } from "@/lib/symbols";
import { Badge } from "./Badge";
import { RowMenu } from "./RowMenu";
import { Sparkline } from "./Sparkline";
import { chartHref, guideSeen, useUi } from "./UiProvider";

export interface OverviewRow {
  key: string;
  name: string;
  /** The name written in the yaml, if any (kept on undo) */
  yamlName: string | null;
  ticker: string;
  source: Source | "expr";
  currency: string | null;
  bench: string | null;
  benchLabel: string | null;
  stats: Stats | null;
  syncError: string | null;
}

export interface OverviewData {
  groups: { name: string; rows: OverviewRow[] }[];
  periods: ChangePeriod[];
  updown: UpDown;
  conditions: { id: string; label: string }[];
  lastReviewDays: number | null;
  lastSync: number | null;
  firstRun: boolean;
  /** Muted lines above the table: yaml settings that are ignored */
  notices: string[];
  /** A visitor on a shared instance: sees the owner's list as the example, display choices stay in the page */
  readOnly: boolean;
}

type SortKey = "last" | "ddAth" | "pos52" | ChangePeriod;
type Sort = { key: SortKey; dir: 1 | -1 } | null;

function sortValue(row: OverviewRow, key: SortKey): number | null {
  const s = row.stats;
  if (!s) return null;
  if (key === "last") return s.last;
  if (key === "ddAth") return s.ddAth;
  if (key === "pos52") return s.pos52;
  return s.changes[key];
}

function sortRows(rows: OverviewRow[], sort: Sort): OverviewRow[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return (va - vb) * sort.dir;
  });
}

/**
 * Column widths shared by every group, so the price column sits at the same x everywhere.
 * The 52-week bar and the sparkline only fit from xl (1280px) up; below md the table becomes a list.
 */
const COL = { price: 112, period: 72, ddAth: 72, conditions: 220, menu: 28 }; // pos52 128 and spark 200 come from CSS variables

function PeriodPicker({ value, onChange }: { value: ChangePeriod[]; onChange: (next: ChangePeriod[]) => void }) {
  const toggle = (key: ChangePeriod) => {
    if (value.includes(key)) {
      if (value.length > 1) onChange(value.filter((k) => k !== key));
    } else if (value.length < MAX_PERIODS) {
      onChange([...value, key]);
    }
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-muted">显示的涨跌周期（最多 {MAX_PERIODS} 个）</span>
      {CHANGE_PERIODS.map(({ key, label }) => (
        <button key={key} onClick={() => toggle(key)} aria-pressed={value.includes(key)} className="btn btn-secondary">
          {label}
        </button>
      ))}
    </div>
  );
}

function Badges({ row, conditions }: { row: OverviewRow; conditions: OverviewData["conditions"] }) {
  const results = row.stats?.conditions ?? {};
  return (
    <div className="flex flex-wrap gap-1">
      {conditions.map(({ id, label }) => {
        const r = results[id];
        if (!r) return null;
        if (r.now) return <Badge key={id} label={label} state={r.prev === false ? "fresh" : "on"} title={r.prev === false ? `${label}：本周新触发` : label} />;
        if (r.prev && r.now === false) return <Badge key={id} label={label} state="off" title={`${label}：本周失效`} />;
        return null;
      })}
    </div>
  );
}

function Th({
  label,
  sortKey,
  sort,
  onSort,
  width,
  className = "",
}: {
  label: string;
  sortKey?: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  width?: number;
  className?: string;
}) {
  const active = sortKey !== undefined && sort?.key === sortKey;
  const sorted = active ? (sort.dir < 0 ? "descending" : "ascending") : undefined;
  return (
    <th style={width ? { width } : undefined} aria-sort={sorted} className={`p-0 text-[11px] font-normal text-muted ${className}`}>
      {sortKey ? (
        <button
          onClick={() => onSort(sortKey)}
          className={`flex h-7 w-full items-center gap-1 px-2 hover:text-fg ${className.includes("text-right") ? "justify-end" : ""} ${active ? "text-fg" : ""}`}
          title={active ? (sort.dir < 0 ? "降序，再点升序" : "升序，再点恢复默认") : "点击排序"}
        >
          {label}
          <span className="w-2 text-[9px]">{active ? (sort.dir < 0 ? "▼" : "▲") : ""}</span>
        </button>
      ) : (
        <span className="flex h-7 items-center px-2">{label}</span>
      )}
    </th>
  );
}

export function Overview({ data }: { data: OverviewData }) {
  const router = useRouter();
  const { openSearch, toast, login, openGuide } = useUi();
  const readOnly = data.readOnly;
  const [, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [choosingPeriods, setChoosingPeriods] = useState(false);
  const [periods, setPeriodsState] = useState(data.periods);
  const [updown, setUpdownState] = useState(data.updown);
  const [message, setMessage] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const closeMenu = useCallback(() => setMenuFor(null), []);

  // the how-to opens once per browser, on the first visit to the overview
  useEffect(() => {
    if (!guideSeen()) openGuide();
  }, [openGuide]);

  useEffect(() => {
    if (!data.firstRun) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [data.firstRun, router]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        setMessage(null);
        done?.();
      } else setMessage(result.error ?? "操作失败");
    });

  const onSort = (key: SortKey) => setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  const changeUpdown = (next: UpDown) => {
    if (next === updown) return;
    setUpdownState(next);
    if (next === "red-up") document.documentElement.dataset.updown = "red-up";
    else delete document.documentElement.dataset.updown;
    if (!readOnly) act(() => setUpdown(next));
  };

  const remove = (row: OverviewRow, group: string) => {
    closeMenu();
    act(
      () => removeSymbol(row.key),
      () =>
        toast(`已移除 ${row.name}`, {
          action: {
            label: "撤销",
            onClick: () => act(() => addSymbol({ key: row.key, group, name: row.yamlName ?? undefined, bench: row.bench ?? undefined })),
          },
        }),
    );
  };

  const shownPeriods = CHANGE_PERIODS.filter((p) => periods.includes(p.key));
  const groupNames = data.groups.map((g) => g.name);
  const colCount = 7 + shownPeriods.length;

  const menu = (row: OverviewRow, group: string) =>
    menuFor === row.key && (
      <RowMenu
        readOnly={readOnly}
        onLogin={() => {
          closeMenu();
          login();
        }}
        name={row.name}
        group={group}
        groups={groupNames}
        benchLabel={row.benchLabel}
        onOpen={() => router.push(chartHref(row.key))}
        onMove={(target) => {
          closeMenu();
          act(() => moveSymbol(row.key, target), () => toast(`${row.name} 已移到 ${target}`));
        }}
        onRename={(name) => {
          closeMenu();
          act(() => renameSymbol(row.key, name));
        }}
        onBench={(bench) => {
          closeMenu();
          act(() => setBench(row.key, bench));
        }}
        onRemove={() => remove(row, group)}
        onClose={closeMenu}
      />
    );

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-5">
      {data.notices.map((n) => (
        <p key={n} className="mb-2 text-xs text-muted">
          {n}
        </p>
      ))}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-medium">{readOnly ? "示例列表" : "自选"}</h1>
          <span className="text-xs text-muted">{fmtAgo(data.lastSync)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/review" className="btn">
            {data.lastReviewDays === null ? "还没有复盘" : data.lastReviewDays === 0 ? "今天复盘过" : `上次复盘 ${data.lastReviewDays} 天前`}
          </Link>
          <button onClick={() => setChoosingPeriods((v) => !v)} aria-pressed={choosingPeriods} className="btn" title="选择显示的涨跌周期">
            周期 · {shownPeriods.map((p) => p.label).join(" ")}
          </button>
          <div className="seg" role="group" aria-label="涨跌颜色">
            <button onClick={() => changeUpdown("green-up")} aria-pressed={updown === "green-up"}>
              绿涨
            </button>
            <button onClick={() => changeUpdown("red-up")} aria-pressed={updown === "red-up"}>
              红涨
            </button>
          </div>
          {!readOnly && (
            <>
              <button
                onClick={() => {
                  setRefreshing(true);
                  startTransition(async () => {
                    const result = await refresh();
                    setMessage(result.ok ? null : result.error);
                    setRefreshing(false);
                  });
                }}
                disabled={refreshing}
                className="btn"
              >
                {refreshing ? "同步中…" : "刷新"}
              </button>
              <button onClick={() => openSearch()} className="btn btn-secondary">
                + 添加
              </button>
            </>
          )}
        </div>
      </div>

      {choosingPeriods && (
        <PeriodPicker
          value={periods}
          onChange={(next) => {
            setPeriodsState(next);
            if (!readOnly) act(() => setPeriods(next));
          }}
        />
      )}
      {message && <p className="mb-3 text-xs text-down">{message}</p>}
      {data.firstRun && <p className="mb-3 text-sm text-muted">首次拉取中，正在从数据源获取全部历史，稍等几秒…</p>}
      {data.groups.length === 0 && (
        <p className="mb-3 text-sm text-muted">
          还没有自选。按 <kbd className="rounded border border-line px-1 font-mono">/</kbd> 搜索并添加。
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="hidden w-full table-fixed border-separate border-spacing-0 text-xs md:table">
          <colgroup>
            <col />
            <col style={{ width: COL.price }} />
            {shownPeriods.map((p) => (
              <col key={p.key} style={{ width: COL.period }} />
            ))}
            <col style={{ width: COL.ddAth }} />
            <col style={{ width: "var(--col-pos52)" }} />
            <col style={{ width: COL.conditions }} />
            <col style={{ width: "var(--col-spark)" }} />
            <col style={{ width: COL.menu }} />
          </colgroup>
          <thead>
            <tr className="text-left">
              <Th label="名称" sort={sort} onSort={onSort} />
              <Th label="价格" sortKey="last" sort={sort} onSort={onSort} className="text-right" />
              {shownPeriods.map((p) => (
                <Th key={p.key} label={p.label} sortKey={p.key} sort={sort} onSort={onSort} className="text-right" />
              ))}
              <Th label="距高点" sortKey="ddAth" sort={sort} onSort={onSort} className="text-right" />
              <Th label="52周" sortKey="pos52" sort={sort} onSort={onSort} className="wide-col" />
              <Th label="条件" sort={sort} onSort={onSort} />
              <Th label="两年" sort={sort} onSort={onSort} className="wide-col" />
              <th />
            </tr>
          </thead>
          <tbody>
            {data.groups.map((group) => (
              <GroupRows key={group.name} group={group} sort={sort} colCount={colCount} shownPeriods={shownPeriods} conditions={data.conditions} menuFor={menuFor} setMenuFor={setMenuFor} menu={menu} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: one card per symbol, three lines. */}
      <div className="md:hidden">
        {data.groups.map((group) => (
          <section key={group.name} className="mb-4">
            <h2 className="mb-1 px-1 text-xs font-medium text-muted">{group.name}</h2>
            <ul className="divide-y divide-line rounded-lg border border-line bg-card">
              {group.rows.length === 0 && <li className="px-3 py-2 text-xs text-muted">这组还没有标的</li>}
              {sortRows(group.rows, sort).map((row) => (
                <li key={row.key} className="relative">
                  <Link href={chartHref(row.key)} className="block px-3 py-2 text-xs">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm">{row.name}</span>
                      <span className="tabular shrink-0 text-sm">{row.stats ? fmtPrice(row.stats.last) : "—"}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 font-mono text-[11px]">
                      <span className="text-muted">{row.ticker}</span>
                      {shownPeriods.map((p) => (
                        <span key={p.key} className={`tabular ${changeColor(row.stats?.changes[p.key])}`}>
                          {p.label} {fmtPct(row.stats?.changes[p.key])}
                        </span>
                      ))}
                    </div>
                    <div className="mt-1">
                      <Badges row={row} conditions={data.conditions} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}

function GroupRows({
  group,
  sort,
  colCount,
  shownPeriods,
  conditions,
  menuFor,
  setMenuFor,
  menu,
}: {
  group: OverviewData["groups"][number];
  sort: Sort;
  colCount: number;
  shownPeriods: (typeof CHANGE_PERIODS)[number][];
  conditions: OverviewData["conditions"];
  menuFor: string | null;
  setMenuFor: (key: string | null) => void;
  menu: (row: OverviewRow, group: string) => React.ReactNode;
}) {
  const router = useRouter();
  const cell = "border-t border-line px-2 py-1.5";
  return (
    <>
      <tr>
        <td colSpan={colCount} className="pt-4 pb-1 text-xs font-medium text-muted">
          {group.name}
        </td>
      </tr>
      {group.rows.length === 0 && (
        <tr>
          <td colSpan={colCount} className={`${cell} text-muted`}>
            这组还没有标的
          </td>
        </tr>
      )}
      {sortRows(group.rows, sort).map((row) => {
        const s = row.stats;
        const href = chartHref(row.key);
        return (
          <tr
            key={row.key}
            onClick={() => router.push(href)}
            onAuxClick={(e) => {
              if (e.button === 1) window.open(href, "_blank");
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuFor(row.key);
            }}
            className="group cursor-pointer bg-card hover:bg-bg/60"
          >
            <td className={`${cell} rounded-l-md`}>
              <Link href={href} onClick={(e) => e.stopPropagation()} className="block min-w-0">
                <div className="truncate text-sm" title={row.name}>
                  {row.name}
                </div>
                <div className="truncate font-mono text-[11px] text-muted">
                  {row.ticker} · {row.source === "expr" ? "合成" : SOURCE_LABELS[row.source]}
                  {row.currency && ` · ${row.currency}`}
                </div>
                {row.syncError && (
                  <div className="truncate text-[11px] text-down" title={row.syncError}>
                    {row.syncError}
                  </div>
                )}
              </Link>
            </td>
            <td className={`tabular ${cell} text-right text-sm`}>{s ? fmtPrice(s.last) : "—"}</td>
            {shownPeriods.map((p) => (
              <td key={p.key} className={`tabular ${cell} text-right ${changeColor(s?.changes[p.key])}`}>
                {fmtPct(s?.changes[p.key])}
              </td>
            ))}
            <td className={`tabular ${cell} text-right ${changeColor(s?.ddAth)}`}>{fmtPct(s?.ddAth)}</td>
            <td className={`${cell} wide-col`}>
              {s?.pos52 != null && (
                <div className="relative h-1 w-20 rounded bg-line" title={`52 周区间位置 ${Math.round(s.pos52 * 100)}%`}>
                  <div className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded bg-fg" style={{ left: `${Math.round(s.pos52 * 100)}%` }} />
                </div>
              )}
            </td>
            <td className={cell}>
              <Badges row={row} conditions={conditions} />
            </td>
            <td className={`${cell} wide-col py-1`}>{s && <Sparkline values={s.spark} width={180} height={26} className="w-[180px]" />}</td>
            <td className={`relative ${cell} rounded-r-md px-0 text-right`}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuFor(menuFor === row.key ? null : row.key);
                }}
                aria-haspopup="menu"
                aria-expanded={menuFor === row.key}
                aria-label={`${row.name} 的操作`}
                className={`h-6 w-6 rounded text-sm leading-none text-muted hover:bg-line hover:text-fg focus-visible:opacity-100 group-hover:opacity-100 ${menuFor === row.key ? "opacity-100" : "opacity-0"}`}
              >
                ⋯
              </button>
              {menu(row, group.name)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
