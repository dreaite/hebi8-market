"use client";

import { useState } from "react";
import { INDICATORS, type IndicatorDef } from "@/indicators/catalog";
import type { FormulaDef } from "@/lib/config";
import { FormulaEditor, type FormulaScope } from "./FormulaEditor";

export interface FormulaStatus {
  def: FormulaDef;
  /** Why it cannot run for this symbol (e.g. no benchmark), or null */
  error: string | null;
}

interface IndicatorBarProps {
  enabled: string[];
  /** Effective params for the current timeframe */
  params: Record<string, number[]>;
  overridden: Set<string>;
  hasBenchmark: boolean;
  formulas: FormulaStatus[];
  scope: FormulaScope;
  onToggle: (name: string) => void;
  /** null resets to the default for this timeframe */
  onParams: (name: string, params: number[] | null) => void;
  onSaveFormula: (def: FormulaDef) => Promise<string | null>;
  onDeleteFormula: (id: string) => Promise<string | null>;
  /** Bumped by the page on Esc; any open editor closes */
  closeSeq?: number;
}

const chipClass = (on: boolean) =>
  `chip flex h-[26px] shrink-0 items-center rounded-full border text-xs transition-colors ${
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
      <input value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-invalid={!parsed} className="input w-36 font-mono" />
      <span className="text-muted">{def.hint}</span>
      <button type="submit" disabled={!parsed} className="btn btn-primary">
        应用
      </button>
      {overridden && (
        <button
          type="button"
          onClick={() => {
            onSave(null);
            onClose();
          }}
          className="btn"
        >
          恢复默认
        </button>
      )}
      <button type="button" onClick={onClose} className="btn">
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
  scope,
  onToggle,
  onParams,
  onSaveFormula,
  onDeleteFormula,
  closeSeq = 0,
}: IndicatorBarProps) {
  // editor state is tagged with the closeSeq it was opened under, so a bump closes it without an effect
  const [editingState, setEditingState] = useState<{ seq: number; name: string | null }>({ seq: 0, name: null });
  const [formulaState, setFormulaState] = useState<{ seq: number; value: FormulaDef | "new" | null }>({ seq: 0, value: null });
  const editing = editingState.seq === closeSeq ? editingState.name : null;
  const formulaEditing = formulaState.seq === closeSeq ? formulaState.value : null;
  const setEditing = (name: string | null) => setEditingState({ seq: closeSeq, name });
  const setFormulaEditing = (value: FormulaDef | "new" | null) => setFormulaState({ seq: closeSeq, value });
  const editingDef = INDICATORS.find((d) => d.name === editing);

  return (
    <div className="flex flex-col gap-2">
      {/* one scrolling row on narrow screens, wrapping otherwise */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 sm:flex-wrap sm:overflow-visible sm:pb-0">
        {INDICATORS.map((def) => {
          const on = enabled.includes(def.name);
          const unavailable = def.needsBenchmark && !hasBenchmark;
          const p = params[def.name] ?? [];
          return (
            <div
              key={def.name}
              className={`${chipClass(on && !unavailable)} ${unavailable ? "opacity-40" : ""}`}
              title={unavailable ? "需要在 hebi8.yaml 里设置 bench" : def.hint}
            >
              <button onClick={() => !unavailable && onToggle(def.name)} className="h-full pr-1 pl-3" disabled={unavailable}>
                {def.label}
              </button>
              {on && !unavailable && p.length > 0 ? (
                <button
                  onClick={() => setEditing(editing === def.name ? null : def.name)}
                  className={`h-full pr-3 pl-1 font-mono text-[11px] hover:text-fg ${overridden.has(def.name) ? "text-fg" : "text-muted"}`}
                  title={overridden.has(def.name) ? "修改参数（已自定义）" : "修改参数"}
                >
                  {p.join("·")}
                </button>
              ) : (
                <span className="pr-2" />
              )}
            </div>
          );
        })}
        <span className="mx-1 h-4 w-px shrink-0 bg-line" />
        {formulas.map(({ def, error }) => (
          <div
            key={def.id}
            className={`${chipClass(enabled.includes(def.id) && !error)} ${error ? "border-down/50 opacity-70" : ""}`}
            title={error ?? def.formula}
          >
            <button onClick={() => !error && onToggle(def.id)} className="h-full pr-1 pl-3" disabled={Boolean(error)}>
              <span className="mr-1 font-mono text-muted italic">ƒ</span>
              {def.label}
            </button>
            <button
              onClick={() => setFormulaEditing(formulaEditing !== "new" && formulaEditing?.id === def.id ? null : def)}
              className="h-full pr-3 pl-1 text-[11px] text-muted hover:text-fg"
              title="编辑公式"
            >
              ✎
            </button>
          </div>
        ))}
        <button
          onClick={() => setFormulaEditing(formulaEditing === "new" ? null : "new")}
          className="chip h-[26px] shrink-0 rounded-full border border-dashed border-line px-3 text-xs text-muted hover:border-muted hover:text-fg"
          title="用公式定义自己的指标，保存在 hebi8.yaml"
        >
          + 公式指标
        </button>
      </div>
      {formulaEditing && (
        <FormulaEditor
          key={formulaEditing === "new" ? "new" : formulaEditing.id}
          initial={formulaEditing === "new" ? null : formulaEditing}
          scope={scope}
          onSave={async (def) => {
            const error = await onSaveFormula(def);
            if (!error) setFormulaEditing(null);
            return error;
          }}
          onDelete={
            formulaEditing === "new"
              ? undefined
              : async () => {
                  const error = await onDeleteFormula(formulaEditing.id);
                  if (!error) setFormulaEditing(null);
                  return error;
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
