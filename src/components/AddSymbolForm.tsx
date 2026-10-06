"use client";

import { useEffect, useState, useTransition } from "react";
import { addSymbol } from "@/app/actions";
import type { SearchHit } from "@/lib/api-types";

interface AddSymbolFormProps {
  groups: string[];
  onDone: () => void;
}

const NEW_GROUP = "__new__";

/** One input: a key, an alias, or free text that searches Yahoo / TradingView / Binance. */
export function AddSymbolForm({ groups, onDone }: AddSymbolFormProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<SearchHit | null>(null);
  const [group, setGroup] = useState(groups[0] ?? NEW_GROUP);
  const [newGroup, setNewGroup] = useState("");
  const [name, setName] = useState("");
  const [bench, setBench] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || picked?.key === q) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => (res.ok ? (res.json() as Promise<SearchHit[]>) : []))
        .then((list) => setHits(list))
        .catch(() => undefined)
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, picked]);

  const key = picked?.key ?? query.trim();
  const targetGroup = group === NEW_GROUP ? newGroup.trim() : group;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await addSymbol({ key, group: targetGroup, name, bench });
      if (result.ok) onDone();
      else setError(result.error);
    });
  };

  const input = "h-8 rounded border border-line bg-bg px-2 text-sm outline-none focus:border-accent";
  return (
    <form onSubmit={submit} className="mb-5 rounded-lg border border-line bg-card p-4 text-xs">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          代码、别名或搜索
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPicked(null);
            }}
            placeholder="yahoo:AAPL / BTC / apple / TVC:US10Y"
            className={`${input} w-72 font-mono`}
            required
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          分组
          <select value={group} onChange={(e) => setGroup(e.target.value)} className={input}>
            {groups.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            <option value={NEW_GROUP}>新建分组…</option>
          </select>
        </label>
        {group === NEW_GROUP && (
          <label className="flex flex-col gap-1 text-[11px] text-muted">
            分组名
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} className={`${input} w-28`} required />
          </label>
        )}
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          名称（可选）
          <input value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-32`} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-muted">
          基准（可选，别名或 key）
          <input value={bench} onChange={(e) => setBench(e.target.value)} placeholder="SPY" className={`${input} w-36 font-mono`} />
        </label>
        <button type="submit" disabled={busy || !key || !targetGroup} className="h-8 rounded bg-fg px-4 text-sm text-bg disabled:opacity-50">
          {busy ? "拉取中…" : "添加"}
        </button>
        <button type="button" onClick={onDone} className="h-8 px-2 text-sm text-muted hover:text-fg">
          取消
        </button>
      </div>
      {!picked && (hits.length > 0 || searching) && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {searching && hits.length === 0 && <li className="text-muted">搜索中…</li>}
          {hits.map((h) => (
            <li key={h.key}>
              <button
                type="button"
                onClick={() => {
                  setPicked(h);
                  setQuery(h.key);
                  setHits([]);
                }}
                className="rounded-full border border-line px-2.5 py-1 hover:border-muted"
                title={h.key}
              >
                <span className="font-mono">{h.key}</span>
                <span className="ml-1.5 text-muted">
                  {h.name}
                  {h.exchange && ` · ${h.exchange}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <p className="mt-3 text-muted">
          将添加 <span className="font-mono text-fg">{picked.key}</span> {picked.name}
        </p>
      )}
      {error && <p className="mt-3 text-down">{error}</p>}
      <p className="mt-3 text-[11px] text-muted">添加时会先拉取一次数据作为校验；合成标的写成 =BTC/GOLD（别名）或 =&quot;binance:BTCUSDT&quot;/&quot;tv:TVC:GOLD&quot;。</p>
    </form>
  );
}
