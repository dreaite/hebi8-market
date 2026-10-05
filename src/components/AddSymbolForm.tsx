"use client";

import { useState } from "react";
import { SOURCES, SOURCE_LABELS, type Source } from "@/lib/symbols";

const PLACEHOLDERS: Record<Source, string> = {
  yahoo: "AAPL / 0700.HK / 600519.SS / ^GSPC",
  binance: "BTCUSDT / SOLUSDT",
  tv: "TVC:US10Y / HSI:HSTECH / FX_IDC:USDCNH",
};

interface AddSymbolFormProps {
  onAdded: () => void;
  onCancel: () => void;
}

export function AddSymbolForm({ onAdded, onCancel }: AddSymbolFormProps) {
  const [source, setSource] = useState<Source>("yahoo");
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [benchmark, setBenchmark] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, ticker, name, benchmark }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage(json.error ?? "添加失败");
        return;
      }
      if (json.warning) setMessage(json.warning);
      setTicker("");
      setName("");
      setBenchmark("");
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  const input = "h-8 rounded border border-line bg-bg px-2 text-sm outline-none focus:border-accent";
  return (
    <form onSubmit={submit} className="mb-5 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          数据源
          <select value={source} onChange={(e) => setSource(e.target.value as Source)} className={input}>
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          代码
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder={PLACEHOLDERS[source]}
            className={`${input} w-64 font-mono`}
            required
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          名称（可选）
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-36`} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          对比基准（可选，用于相对强弱）
          <input
            value={benchmark}
            onChange={(e) => setBenchmark(e.target.value)}
            placeholder="yahoo:SPY"
            className={`${input} w-44 font-mono`}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="h-8 rounded bg-fg px-4 text-sm text-bg disabled:opacity-50"
        >
          {busy ? "拉取中…" : "添加"}
        </button>
        <button type="button" onClick={onCancel} className="h-8 px-2 text-sm text-muted hover:text-fg">
          取消
        </button>
      </div>
      {message && <p className="mt-3 text-xs text-down">{message}</p>}
      <p className="mt-3 text-[11px] text-muted">已存在的代码再次提交会更新名称和基准。</p>
    </form>
  );
}
