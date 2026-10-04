"use client";

import { useState } from "react";
import { INDICATORS, type IndicatorDef } from "@/indicators/catalog";

interface IndicatorBarProps {
  enabled: string[];
  /** Effective params for the current timeframe */
  params: Record<string, number[]>;
  overridden: Set<string>;
  hasBenchmark: boolean;
  onToggle: (name: string) => void;
  /** null resets to the default for this timeframe */
  onParams: (name: string, params: number[] | null) => void;
}

function parseParams(text: string): number[] | null {
  const parts = text.split(/[\s,，]+/).filter(Boolean).map(Number);
  return parts.length > 0 && parts.every((n) => Number.isFinite(n) && n > 0) ? parts : null;
}

function ParamEditor({
  def,
  value,
  overridden,
  onSave,
  onClose,
}: {
  def: IndicatorDef;
  value: number[];
  overridden: boolean;
  onSave: (params: number[] | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const parsed = parseParams(text);
  return (
    <form
      className="flex items-center gap-2 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed) {
          onSave(parsed);
          onClose();
        }
      }}
    >
      <span className="text-muted">{def.label} 参数</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
        className={`h-6 w-36 rounded border bg-bg px-1.5 font-mono outline-none ${parsed ? "border-line focus:border-accent" : "border-down"}`}
      />
      <span className="text-muted">{def.hint}</span>
      <button type="submit" disabled={!parsed} className="text-accent disabled:opacity-40">
        应用
      </button>
      {overridden && (
        <button
          type="button"
          onClick={() => {
            onSave(null);
            onClose();
          }}
          className="text-muted hover:text-fg"
        >
          恢复默认
        </button>
      )}
      <button type="button" onClick={onClose} className="text-muted hover:text-fg">
        取消
      </button>
    </form>
  );
}

export function IndicatorBar({ enabled, params, overridden, hasBenchmark, onToggle, onParams }: IndicatorBarProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const editingDef = INDICATORS.find((d) => d.name === editing);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {INDICATORS.map((def) => {
          const on = enabled.includes(def.name);
          const unavailable = def.needsBenchmark && !hasBenchmark;
          const p = params[def.name] ?? [];
          return (
            <div
              key={def.name}
              className={`flex h-7 items-center rounded-full border text-xs transition-colors ${
                on && !unavailable ? "border-fg/40 bg-card text-fg" : "border-line text-muted"
              } ${unavailable ? "opacity-40" : ""}`}
              title={unavailable ? "需要在添加时设置对比基准" : def.hint}
            >
              <button
                onClick={() => !unavailable && onToggle(def.name)}
                className="h-full pr-1 pl-3"
                disabled={unavailable}
              >
                {def.label}
              </button>
              {on && !unavailable && p.length > 0 ? (
                <button
                  onClick={() => setEditing(editing === def.name ? null : def.name)}
                  className={`h-full pr-3 pl-1 font-mono text-[11px] hover:text-accent ${overridden.has(def.name) ? "text-accent" : "text-muted"}`}
                  title="修改参数"
                >
                  {p.join("·")}
                </button>
              ) : (
                <span className="pr-2" />
              )}
            </div>
          );
        })}
      </div>
      {editingDef && (
        <ParamEditor
          key={editingDef.name}
          def={editingDef}
          value={params[editingDef.name] ?? []}
          overridden={overridden.has(editingDef.name)}
          onSave={(p) => onParams(editingDef.name, p)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
