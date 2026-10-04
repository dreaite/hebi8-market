"use client";

import { useState } from "react";
import { INDICATORS, type IndicatorDef } from "@/indicators/catalog";
import { formulaIndicatorName, type FormulaDef } from "@/indicators/formula-indicators";
import { FormulaEditor } from "./FormulaEditor";

interface IndicatorBarProps {
  enabled: string[];
  /** Effective params for the current timeframe */
  params: Record<string, number[]>;
  overridden: Set<string>;
  hasBenchmark: boolean;
  formulas: FormulaDef[];
  onToggle: (name: string) => void;
  /** null resets to the default for this timeframe */
  onParams: (name: string, params: number[] | null) => void;
  /** Without an id the formula is new */
  onSaveFormula: (def: Omit<FormulaDef, "id"> & { id?: string }) => void;
  onDeleteFormula: (id: string) => void;
}

const chipClass = (on: boolean) =>
  `flex h-7 items-center rounded-full border text-xs transition-colors ${
    on ? "border-fg/40 bg-card text-fg" : "border-line text-muted"
  }`;

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

export function IndicatorBar({
  enabled,
  params,
  overridden,
  hasBenchmark,
  formulas,
  onToggle,
  onParams,
  onSaveFormula,
  onDeleteFormula,
}: IndicatorBarProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [formulaEditing, setFormulaEditing] = useState<FormulaDef | "new" | null>(null);
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
              className={`${chipClass(on && !unavailable)} ${unavailable ? "opacity-40" : ""}`}
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
        <span className="mx-1 h-4 w-px bg-line" />
        {formulas.map((f) => {
          const name = formulaIndicatorName(f.id);
          return (
            <div key={f.id} className={chipClass(enabled.includes(name))} title={f.source}>
              <button onClick={() => onToggle(name)} className="h-full pr-1 pl-3">
                <span className="mr-1 font-mono text-muted italic">ƒ</span>
                {f.label}
              </button>
              <button
                onClick={() => setFormulaEditing(formulaEditing === f ? null : f)}
                className="h-full pr-3 pl-1 text-[11px] text-muted hover:text-accent"
                title="编辑公式"
              >
                ✎
              </button>
            </div>
          );
        })}
        <button
          onClick={() => setFormulaEditing(formulaEditing === "new" ? null : "new")}
          className="h-7 rounded-full border border-dashed border-line px-3 text-xs text-muted hover:border-muted hover:text-fg"
          title="用公式定义自己的指标"
        >
          + 公式指标
        </button>
      </div>
      {formulaEditing && (
        <FormulaEditor
          key={formulaEditing === "new" ? "new" : formulaEditing.id}
          initial={formulaEditing === "new" ? null : formulaEditing}
          onSave={(def) => {
            onSaveFormula(formulaEditing === "new" ? def : { ...def, id: formulaEditing.id });
            setFormulaEditing(null);
          }}
          onDelete={
            formulaEditing === "new"
              ? undefined
              : () => {
                  onDeleteFormula(formulaEditing.id);
                  setFormulaEditing(null);
                }
          }
          onClose={() => setFormulaEditing(null)}
        />
      )}
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
