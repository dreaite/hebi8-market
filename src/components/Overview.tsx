"use client";

import { useCallback, useEffect, useState } from "react";
import type { OverviewItem } from "@/lib/api-types";
import { fmtAgo } from "@/lib/format";
import { CHANGE_PERIODS, DEFAULT_PERIODS, MAX_PERIODS, type ChangePeriod } from "@/lib/periods";
import { usePref } from "@/lib/prefs";
import { AddSymbolForm } from "./AddSymbolForm";
import { SymbolCard } from "./SymbolCard";

function PeriodPicker({ value, onChange }: { value: ChangePeriod[]; onChange: (next: ChangePeriod[]) => void }) {
  const toggle = (key: ChangePeriod) => {
    if (value.includes(key)) {
      if (value.length > 1) onChange(value.filter((k) => k !== key));
    } else if (value.length < MAX_PERIODS) {
      onChange([...value, key]);
    }
  };
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="mr-1 text-muted">卡片显示的涨跌周期（最多 {MAX_PERIODS} 个）</span>
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

export function Overview() {
  const [items, setItems] = useState<OverviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [choosingPeriods, setChoosingPeriods] = useState(false);
  const [periods, setPeriods] = usePref<ChangePeriod[]>("periods", DEFAULT_PERIODS);

  const load = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/overview${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setItems(((await res.json()) as { items: OverviewItem[] }).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
  }, [load]);

  const remove = async (key: string) => {
    await fetch(`/api/watchlist?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    setItems((prev) => prev?.filter((i) => i.key !== key) ?? null);
  };

  const lastSync = items?.reduce<number | null>((m, i) => (i.syncedAt && (!m || i.syncedAt > m) ? i.syncedAt : m), null);

  return (
    <main className="mx-auto w-full max-w-[1400px] px-5 py-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-base font-medium">自选</h1>
          {items && <span className="text-xs text-muted">{fmtAgo(lastSync ?? null)}</span>}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <button onClick={() => setChoosingPeriods((v) => !v)} className="text-muted hover:text-fg">
            周期
          </button>
          <button onClick={() => load(true)} disabled={refreshing} className="text-muted hover:text-fg disabled:opacity-50">
            {refreshing ? "同步中…" : "刷新数据"}
          </button>
          <button onClick={() => setAdding((v) => !v)} className="rounded border border-line px-3 py-1 hover:border-muted">
            + 添加
          </button>
        </div>
      </div>

      {choosingPeriods && <PeriodPicker value={periods} onChange={setPeriods} />}

      {adding && (
        <AddSymbolForm
          onAdded={() => {
            setAdding(false);
            void load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {error && <p className="mb-4 text-sm text-down">加载失败：{error}</p>}

      {!items ? (
        <p className="text-sm text-muted">首次打开会拉取全部历史数据，稍等几秒…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">自选为空，点右上角添加。</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-4">
          {items.map((item) => (
            <SymbolCard key={item.key} item={item} periods={periods} onRemove={remove} />
          ))}
        </div>
      )}
    </main>
  );
}
