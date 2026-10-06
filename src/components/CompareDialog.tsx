"use client";

import { useState } from "react";
import type { SearchContext } from "@/lib/search";
import type { CompareEntry } from "@/lib/vault";
import { IconClose } from "./chart-icons";
import { Dialog } from "./Dialog";
import { SymbolSearch } from "./SymbolSearch";

const ACTIONS = [
  { id: "percent", label: "同百分比坐标" },
  { id: "pane", label: "新窗格" },
];

/** TradingView's「比较商品」: search, then add on the same % scale or in a new pane. */
export function CompareDialog({
  ctx,
  symbolKey,
  existing,
  names,
  onAdd,
  onRemove,
  onClose,
}: {
  ctx: SearchContext;
  symbolKey: string;
  existing: CompareEntry[];
  names: Record<string, string>;
  onAdd: (key: string, mode: CompareEntry["mode"]) => Promise<boolean>;
  onRemove: (key: string) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="比较商品" onClose={onClose} className="max-w-[600px]">
      <SymbolSearch
        key={existing.length}
        mode="pick"
        ctx={ctx}
        placeholder="搜索：QQQ / US10Y / apple / tv:TVC:US10Y"
        exclude={[symbolKey, ...existing.map((c) => c.key)]}
        busy={busy}
        error={error}
        pickActions={ACTIONS}
        onPick={async (d) => {
          setBusy(true);
          setError(null);
          const ok = await onAdd(d.key, d.action === "pane" ? "pane" : "percent");
          setBusy(false);
          if (!ok) setError(`无法拉取 ${d.key}`);
        }}
        onClose={onClose}
      />
      {existing.length > 0 && (
        <div className="border-t border-line py-1 text-xs">
          <div className="px-3 pt-1.5 pb-1 text-[11px] text-muted">已添加</div>
          {existing.map((c) => (
            <div key={c.key} className="flex items-center gap-2 px-3 py-1">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{names[c.key] ?? c.key}</span>
              <span className="shrink-0 text-[11px] text-muted">{c.mode === "pane" ? "新窗格" : "同百分比坐标"}</span>
              <button type="button" onClick={() => onRemove(c.key)} className="tb-btn h-6 min-w-6" title="移除" aria-label={`移除 ${names[c.key] ?? c.key}`}>
                <IconClose size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
