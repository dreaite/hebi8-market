"use client";

import { useState } from "react";
import { INDICATORS, type IndicatorDef } from "@/indicators/catalog";
import type { FormulaDef } from "@/lib/config";
import { TF_LABELS, type Timeframe } from "@/lib/symbols";
import { IconCheck, IconPencil, IconSearch } from "./chart-icons";
import { Dialog } from "./Dialog";
import { FormulaEditor, type FormulaScope } from "./FormulaEditor";

export interface FormulaStatus {
  def: FormulaDef;
  /** Why it cannot run for this symbol (e.g. no benchmark), or null */
  error: string | null;
}

type Category = "builtin" | "formula";

interface IndicatorDialogProps {
  enabled: string[];
  hasBenchmark: boolean;
  formulas: FormulaStatus[];
  scope: FormulaScope;
  /** Open straight into the formula editor (from a legend row's settings) */
  initialFormula?: FormulaDef | "new" | null;
  onToggle: (name: string) => void;
  onSaveFormula: (def: FormulaDef) => Promise<string | null>;
  onDeleteFormula: (id: string) => Promise<string | null>;
  onClose: () => void;
}

/** TradingView's「指标」dialog: search, categories on the left, click a row to add (or remove) it. */
export function IndicatorDialog({ enabled, hasBenchmark, formulas, scope, initialFormula = null, onToggle, onSaveFormula, onDeleteFormula, onClose }: IndicatorDialogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>(initialFormula ? "formula" : "builtin");
  const [editing, setEditing] = useState<FormulaDef | "new" | null>(initialFormula);
  const q = query.trim().toLowerCase();
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));
  const builtins = INDICATORS.filter((d) => match(d.label, d.name, d.hint));
  const mine = formulas.filter((f) => match(f.def.label, f.def.id, f.def.formula));
  // a search spans both categories, like TradingView's
  const showBuiltin = q ? builtins.length > 0 : category === "builtin";
  const showMine = q ? true : category === "formula";

  const row = "flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-fg/5 disabled:cursor-default disabled:opacity-45";

  if (editing) {
    return (
      <Dialog title={editing === "new" ? "新建公式" : `编辑公式 · ${editing.label}`} onClose={onClose} className="max-w-[760px]">
        <div className="overflow-y-auto p-3">
          <FormulaEditor
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            scope={scope}
            onSave={async (def) => {
              const error = await onSaveFormula(def);
              if (!error) setEditing(null);
              return error;
            }}
            onDelete={
              editing === "new"
                ? undefined
                : async () => {
                    const error = await onDeleteFormula(editing.id);
                    if (!error) setEditing(null);
                    return error;
                  }
            }
            onClose={() => setEditing(null)}
          />
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="指标" onClose={onClose} className="max-w-[680px]">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-4">
        <IconSearch className="text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索"
          autoFocus
          spellCheck={false}
          className="h-10 flex-1 bg-transparent text-sm outline-none"
        />
      </div>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-40 shrink-0 flex-col gap-0.5 border-r border-line p-2 text-[13px] sm:flex">
          {(
            [
              ["builtin", "内置"],
              ["formula", "我的公式"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setCategory(id);
                setQuery("");
              }}
              className={`rounded px-3 py-1.5 text-left ${!q && category === id ? "bg-fg/10 font-medium" : "text-muted hover:bg-fg/5 hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="min-h-[320px] flex-1 overflow-y-auto py-1">
          {/* narrow screens: categories as a segmented row */}
          {!q && (
            <div className="seg mx-4 my-2 sm:hidden">
              <button type="button" aria-pressed={category === "builtin"} onClick={() => setCategory("builtin")}>
                内置
              </button>
              <button type="button" aria-pressed={category === "formula"} onClick={() => setCategory("formula")}>
                我的公式
              </button>
            </div>
          )}
          {showBuiltin && (
            <>
              {q && <div className="px-4 pt-2 pb-1 text-[11px] text-muted">内置</div>}
              {builtins.map((def) => {
                const on = enabled.includes(def.name);
                const unavailable = def.needsBenchmark && !hasBenchmark;
                return (
                  <button
                    key={def.name}
                    type="button"
                    disabled={unavailable}
                    onClick={() => onToggle(def.name)}
                    className={row}
                    title={unavailable ? "需要在 hebi8.yaml 里给这个标的设置 bench" : on ? "已添加，点击移除" : "添加到图表"}
                  >
                    <span className="w-4 shrink-0 text-accent">{on && <IconCheck size={16} />}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {def.label}
                      {def.label !== def.name && <span className="ml-2 font-mono text-[11px] text-muted">{def.name}</span>}
                    </span>
                    <span className="hidden shrink-0 truncate text-[11px] text-muted sm:inline">{unavailable ? "需要基准" : def.hint}</span>
                  </button>
                );
              })}
            </>
          )}
          {showMine && (
            <>
              {q && <div className="px-4 pt-2 pb-1 text-[11px] text-muted">我的公式</div>}
              {mine.map(({ def, error }) => {
                const on = enabled.includes(def.id);
                return (
                  <div key={def.id} className="group flex items-center hover:bg-fg/5">
                    <button type="button" disabled={Boolean(error)} onClick={() => onToggle(def.id)} className={`${row} hover:bg-transparent`} title={error ?? def.formula}>
                      <span className="w-4 shrink-0 text-accent">{on && <IconCheck size={16} />}</span>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="mr-1 font-mono text-muted italic">ƒ</span>
                        {def.label}
                      </span>
                      <span className={`hidden shrink-0 truncate font-mono text-[11px] sm:inline ${error ? "text-down" : "text-muted"}`}>{error ?? (def.pane === "main" ? "主图" : "副图")}</span>
                    </button>
                    <button type="button" onClick={() => setEditing(def)} className="tb-btn mr-2 shrink-0" title="编辑公式" aria-label={`编辑 ${def.label}`}>
                      <IconPencil size={16} />
                    </button>
                  </div>
                );
              })}
              {!q && (
                <button type="button" onClick={() => setEditing("new")} className={`${row} text-accent`} title="用公式定义自己的指标，保存在 hebi8.yaml">
                  <span className="w-4 shrink-0 text-center">+</span>
                  新建公式
                </button>
              )}
            </>
          )}
          {q && builtins.length === 0 && mine.length === 0 && <div className="px-4 py-3 text-xs text-muted">没有匹配的指标</div>}
        </div>
      </div>
    </Dialog>
  );
}

function parseParams(text: string): number[] | null {
  const parts = text.split(/[\s,，]+/).filter(Boolean).map(Number);
  return parts.length > 0 && parts.every((n) => Number.isFinite(n) && n > 0) ? parts : null;
}

/** The settings dialog a legend row's gear opens: inputs per timeframe, as before. */
export function ParamDialog({
  def,
  tf,
  value,
  overridden,
  onSave,
  onClose,
}: {
  def: IndicatorDef;
  tf: Timeframe;
  value: number[];
  overridden: boolean;
  onSave: (params: number[] | null) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const parsed = parseParams(text);
  if (value.length === 0 && !overridden) {
    return (
      <Dialog title={`${def.label} 设置`} onClose={onClose} className="max-w-[420px]">
        <div className="flex flex-col gap-3 p-4 text-xs">
          <p className="text-muted">{def.hint}</p>
          <div className="flex justify-end">
            <button type="button" onClick={onClose} className="btn btn-secondary">
              关闭
            </button>
          </div>
        </div>
      </Dialog>
    );
  }
  return (
    <Dialog title={`${def.label} 设置`} onClose={onClose} className="max-w-[420px]">
      <form
        className="flex flex-col gap-3 p-4 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsed) {
            onSave(parsed);
            onClose();
          }
        }}
      >
        <div className="text-[11px] font-medium text-muted">输入</div>
        <label className="flex flex-col gap-1">
          <span className="text-muted">{def.hint}</span>
          <input value={text} onChange={(e) => setText(e.target.value)} onFocus={(e) => e.target.select()} autoFocus aria-invalid={!parsed} className="input h-8 font-mono text-[13px]" />
        </label>
        <p className="text-[11px] text-muted">
          只对{TF_LABELS[tf]}线生效，其它周期各自保存{overridden ? "；当前为自定义值" : ""}。多个参数用逗号分隔。
        </p>
        <div className="flex items-center gap-2 pt-1">
          {overridden && (
            <button
              type="button"
              onClick={() => {
                onSave(null);
                onClose();
              }}
              className="btn btn-secondary"
            >
              恢复默认
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="btn btn-secondary">
            取消
          </button>
          <button type="submit" disabled={!parsed} className="btn btn-primary">
            确定
          </button>
        </div>
      </form>
    </Dialog>
  );
}
