"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { refresh, removeSymbol, setPeriods, setUpdown } from "@/app/actions";
import type { UpDown } from "@/lib/config";
import { changeColor, fmtAgo, fmtPct, fmtPrice } from "@/lib/format";
import { CHANGE_PERIODS, MAX_PERIODS, type ChangePeriod } from "@/lib/periods";
import type { Stats } from "@/lib/stats";
import { SOURCE_LABELS, type Source } from "@/lib/symbols";
import { Sparkline } from "./Sparkline";
import { useUi } from "./UiProvider";

export interface OverviewRow {
  key: string;
  name: string;
  ticker: string;
  source: Source | "expr";
  currency: string | null;
  bench: string | null;
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
  vaultPath: string;
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
      {CHANGE_PERIODS.map(({ key, label }) => {
        const on = value.includes(key);
        return (
          <button
            key={key}
            onClick={() => toggle(key)}
            className={`h-7 rounded-full border px-3 ${on ? "border-fg/40 bg-card text-fg" : "border-line text-muted hover:text-fg"}`}
          >
            {label}
          </button>
        );
      })}
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
        if (r.now) {
          const fresh = r.prev === false;
          return (
            <span
              key={id}
              className={`flex h-5 items-center gap-1 rounded-full border px-1.5 text-[10px] ${fresh ? "border-accent/50 text-fg" : "border-line text-muted"}`}
              title={fresh ? `${label}：本周新触发` : label}
            >
              {fresh && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
              {label}
            </span>
          );
        }
        if (r.prev && r.now === false) {
          return (
            <span key={id} className="flex h-5 items-center rounded-full border border-dashed border-line px-1.5 text-[10px] text-muted/70 line-through" title={`${label}：本周失效`}>
              {label}
            </span>
          );
        }
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
  className = "",
}: {
  label: string;
  sortKey?: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}) {
  const active = sortKey && sort?.key === sortKey;
  return (
    <th className={`px-2 py-1.5 text-[10px] font-normal text-muted ${className}`}>
      {sortKey ? (
        <button onClick={() => onSort(sortKey)} className={`hover:text-fg ${active ? "text-fg" : ""}`}>
          {label}
          {active && (sort.dir < 0 ? " ↓" : " ↑")}
        </button>
      ) : (
        label
      )}
    </th>
  );
}

export function Overview({ data }: { data: OverviewData }) {
  const router = useRouter();
  const { openSearch } = useUi();
  const [pending, startTransition] = useTransition();
  const [refreshing, setRefreshing] = useState(false);
  const [sort, setSort] = useState<Sort>(null);
  const [choosingPeriods, setChoosingPeriods] = useState(false);
  const [periods, setPeriodsState] = useState(data.periods);
  const [updown, setUpdownState] = useState(data.updown);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!data.firstRun) return;
    const id = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(id);
  }, [data.firstRun, router]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result.ok ? null : (result.error ?? "操作失败"));
    });

  const onSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null));

  const toggleUpdown = () => {
    const next: UpDown = updown === "green-up" ? "red-up" : "green-up";
    setUpdownState(next);
    if (next === "red-up") document.documentElement.dataset.updown = "red-up";
    else delete document.documentElement.dataset.updown;
    act(() => setUpdown(next));
  };

  const shownPeriods = CHANGE_PERIODS.filter((p) => periods.includes(p.key));
  const colCount = 7 + shownPeriods.length;

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-medium">自选</h1>
          <span className="text-xs text-muted">{fmtAgo(data.lastSync)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs">
          <Link href="/review" className="text-muted hover:text-fg">
            {data.lastReviewDays === null ? "还没有复盘" : data.lastReviewDays === 0 ? "今天复盘过" : `上次复盘 ${data.lastReviewDays} 天前`}
          </Link>
          <button onClick={() => setChoosingPeriods((v) => !v)} className="text-muted hover:text-fg">
            周期
          </button>
          <button onClick={toggleUpdown} className="flex items-center gap-1.5 text-muted hover:text-fg" title="切换涨跌颜色">
            <span className="inline-block h-2 w-2 rounded-full bg-up" />涨
            <span className="inline-block h-2 w-2 rounded-full bg-down" />跌
          </button>
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
            className="text-muted hover:text-fg disabled:opacity-50"
          >
            {refreshing ? "同步中…" : "刷新"}
          </button>
          <button onClick={() => openSearch()} className="rounded border border-line px-3 py-1 hover:border-muted">
            + 添加
          </button>
        </div>
      </div>

      {choosingPeriods && (
        <PeriodPicker
          value={periods}
          onChange={(next) => {
            setPeriodsState(next);
            act(() => setPeriods(next));
          }}
        />
      )}
      {message && <p className="mb-3 text-xs text-down">{message}</p>}
      {data.firstRun && <p className="mb-3 text-sm text-muted">首次拉取中，正在从数据源获取全部历史，稍等几秒…</p>}

      {data.groups.map((group) => (
        <section key={group.name} className="mb-6">
          <h2 className="mb-1 px-2 text-xs font-medium text-muted">{group.name}</h2>
          <table className="w-full border-separate border-spacing-0 rounded-lg border border-line bg-card text-xs">
            <thead>
              <tr className="text-left">
                <Th label="名称" sort={sort} onSort={onSort} />
                <Th label="价格" sortKey="last" sort={sort} onSort={onSort} className="text-right" />
                {shownPeriods.map((p) => (
                  <Th key={p.key} label={p.label} sortKey={p.key} sort={sort} onSort={onSort} className="text-right" />
                ))}
                <Th label="距高点" sortKey="ddAth" sort={sort} onSort={onSort} className="text-right" />
                <Th label="52周" sortKey="pos52" sort={sort} onSort={onSort} className="hidden md:table-cell" />
                <Th label="条件" sort={sort} onSort={onSort} />
                <Th label="两年" sort={sort} onSort={onSort} className="hidden md:table-cell" />
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {group.rows.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-2 py-2 text-muted">
                    这组还没有标的
                  </td>
                </tr>
              )}
              {sortRows(group.rows, sort).map((row) => {
                const s = row.stats;
                const href = `/chart/${encodeURIComponent(row.key)}`;
                return (
                  <tr
                    key={row.key}
                    onClick={() => router.push(href)}
                    className="group cursor-pointer border-t border-line hover:bg-bg/60"
                  >
                    <td className="border-t border-line px-2 py-1.5">
                      <Link href={href} onClick={(e) => e.stopPropagation()} className="block">
                        <div className="truncate text-sm">{row.name}</div>
                        <div className="truncate font-mono text-[10px] text-muted">
                          {row.ticker} · {row.source === "expr" ? "合成" : SOURCE_LABELS[row.source]}
                          {row.currency && ` · ${row.currency}`}
                        </div>
                        {row.syncError && <div className="truncate text-[10px] text-down">{row.syncError}</div>}
                      </Link>
                    </td>
                    <td className="tabular border-t border-line px-2 py-1.5 text-right text-sm">{s ? fmtPrice(s.last) : "—"}</td>
                    {shownPeriods.map((p) => (
                      <td key={p.key} className={`tabular border-t border-line px-2 py-1.5 text-right ${changeColor(s?.changes[p.key])}`}>
                        {fmtPct(s?.changes[p.key])}
                      </td>
                    ))}
                    <td className={`tabular border-t border-line px-2 py-1.5 text-right ${changeColor(s?.ddAth)}`}>{fmtPct(s?.ddAth)}</td>
                    <td className="hidden border-t border-line px-2 py-1.5 md:table-cell">
                      {s?.pos52 != null && (
                        <div className="relative h-1 w-16 rounded bg-line" title={`52 周区间位置 ${Math.round(s.pos52 * 100)}%`}>
                          <div className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 rounded bg-fg" style={{ left: `${Math.round(s.pos52 * 100)}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="border-t border-line px-2 py-1.5">
                      <Badges row={row} conditions={data.conditions} />
                    </td>
                    <td className="hidden border-t border-line px-2 py-1 md:table-cell">
                      {s && <Sparkline values={s.spark} width={120} height={26} className="w-[120px]" />}
                    </td>
                    <td className="border-t border-line pr-1 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`从自选移除 ${row.name}？缓存的数据会保留。`)) act(() => removeSymbol(row.key));
                        }}
                        disabled={pending}
                        className="hidden h-5 w-5 rounded-full text-[11px] leading-none text-muted group-hover:inline-block hover:text-fg"
                        title="从自选移除"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      <p className="mt-8 text-[11px] text-muted">
        同步时间、别名、条件在 <code className="text-fg">{data.vaultPath}/hebi8.yaml</code> 里直接改。
      </p>
    </main>
  );
}
