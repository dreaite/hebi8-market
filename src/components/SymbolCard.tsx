import Link from "next/link";
import type { OverviewItem } from "@/lib/api-types";
import { changeColor, fmtPct, fmtPrice } from "@/lib/format";
import { CHANGE_PERIODS, type ChangePeriod } from "@/lib/periods";
import { SOURCE_LABELS } from "@/lib/symbols";
import { Sparkline } from "./Sparkline";

interface SymbolCardProps {
  item: OverviewItem;
  periods: ChangePeriod[];
  onRemove: (key: string) => void;
}

function Change({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] text-muted">{label}</span>
      <span className={`tabular text-xs ${changeColor(value)}`}>{fmtPct(value)}</span>
    </div>
  );
}

export function SymbolCard({ item, periods, onRemove }: SymbolCardProps) {
  const { stats } = item;
  return (
    <div className="group relative rounded-lg border border-line bg-card transition-colors hover:border-muted/50">
      <Link href={`/chart?key=${encodeURIComponent(item.key)}`} className="block p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{item.name}</div>
            <div className="truncate font-mono text-[11px] text-muted">
              {item.ticker} · {SOURCE_LABELS[item.source]}
            </div>
          </div>
          {stats && <div className="tabular text-sm font-medium">{fmtPrice(stats.last)}</div>}
        </div>

        {stats ? (
          <>
            <Sparkline values={stats.spark} className="my-3" />
            <div className="flex items-end justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-muted">
                  距高点 <span className={`tabular ${changeColor(stats.ddAth)}`}>{fmtPct(stats.ddAth)}</span>
                </span>
                {stats.pos52 !== null && (
                  <div className="flex items-center gap-1.5" title="当前价在近 52 周高低区间中的位置">
                    <span className="text-[10px] text-muted">52周</span>
                    <div className="relative h-1 w-16 rounded bg-line">
                      <div
                        className="absolute top-1/2 h-2 w-0.5 -translate-y-1/2 rounded bg-fg"
                        style={{ left: `${Math.round(stats.pos52 * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3">
                {CHANGE_PERIODS.filter((p) => periods.includes(p.key)).map((p) => (
                  <Change key={p.key} label={p.label} value={stats.changes[p.key]} />
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="mt-6 text-xs text-down">{item.syncError ?? "暂无数据"}</div>
        )}
      </Link>
      <button
        onClick={() => onRemove(item.key)}
        className="absolute -top-2 -right-2 hidden h-5 w-5 items-center justify-center rounded-full border border-line bg-card text-[11px] leading-none text-muted group-hover:flex hover:text-fg"
        title="从自选移除"
      >
        ×
      </button>
    </div>
  );
}
