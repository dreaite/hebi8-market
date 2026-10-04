"use client";

import { useMemo, useState } from "react";
import { compile, FormulaError, FUNCTIONS, SERIES_VARS } from "@/indicators/formula";
import { FORMULA_EXAMPLES, type FormulaDef } from "@/indicators/formula-indicators";

interface FormulaEditorProps {
  /** null creates a new formula */
  initial: FormulaDef | null;
  onSave: (def: Omit<FormulaDef, "id">) => void;
  onDelete?: () => void;
  onClose: () => void;
}

function validate(source: string): { lines: string[] } | { error: string } {
  try {
    return { lines: compile(source).outputs };
  } catch (err) {
    if (err instanceof FormulaError) {
      return { error: err.pos === undefined ? err.message : `${err.message}（第 ${err.pos + 1} 个字符）` };
    }
    return { error: String(err) };
  }
}

export function FormulaEditor({ initial, onSave, onDelete, onClose }: FormulaEditorProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [pane, setPane] = useState<FormulaDef["pane"]>(initial?.pane ?? "sub");
  const [showHelp, setShowHelp] = useState(false);
  const result = useMemo(() => (source.trim() ? validate(source) : null), [source]);
  const valid = result !== null && "lines" in result && label.trim() !== "";

  const input = "rounded border border-line bg-bg px-2 text-sm outline-none focus:border-accent";
  return (
    <form
      className="rounded-lg border border-line bg-card p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ label: label.trim(), source, pane });
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-muted">
            名称
            <input value={label} onChange={(e) => setLabel(e.target.value)} className={`${input} h-7 w-36`} autoFocus />
          </label>
          <div className="flex gap-3 text-muted">
            {(["main", "sub"] as const).map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-1">
                <input type="radio" checked={pane === p} onChange={() => setPane(p)} className="accent-current" />
                {p === "main" ? "叠加在主图" : "单独副图"}
              </label>
            ))}
          </div>
        </div>
        <label className="flex min-w-[280px] flex-1 flex-col gap-1 text-muted">
          公式（每行或分号一条线，name = 表达式 可命名并被后面引用，# 开头是注释）
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            rows={3}
            spellCheck={false}
            placeholder="(close / sma(close, 40) - 1) * 100"
            className={`${input} py-1.5 font-mono leading-5`}
          />
        </label>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {result === null ? (
          <span className="text-muted">示例：</span>
        ) : "error" in result ? (
          <span className="text-down">{result.error}</span>
        ) : (
          <span className="text-up">✓ {result.lines.length} 条线：{result.lines.join("、")}</span>
        )}
        {result === null &&
          FORMULA_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => {
                setLabel(ex.label);
                setSource(ex.source);
                setPane(ex.pane);
              }}
              className="text-accent hover:underline"
            >
              {ex.label}
            </button>
          ))}
        <span className="flex-1" />
        <button type="button" onClick={() => setShowHelp((v) => !v)} className="text-muted hover:text-fg">
          {showHelp ? "收起语法" : "语法"}
        </button>
        {onDelete && (
          <button type="button" onClick={onDelete} className="text-down hover:underline">
            删除
          </button>
        )}
        <button type="button" onClick={onClose} className="text-muted hover:text-fg">
          取消
        </button>
        <button type="submit" disabled={!valid} className="rounded bg-fg px-3 py-1 text-bg disabled:opacity-40">
          保存
        </button>
      </div>

      {showHelp && (
        <div className="mt-3 grid gap-2 border-t border-line pt-3 text-muted md:grid-cols-2">
          <div>
            <div className="mb-1 text-fg">变量</div>
            {Object.entries(SERIES_VARS).map(([name, desc]) => (
              <div key={name}>
                <code className="text-fg">{name}</code> {desc}
              </div>
            ))}
            <div className="mt-2">运算：+ - * / ^ 和括号；数字可直接参与运算</div>
          </div>
          <div>
            <div className="mb-1 text-fg">函数</div>
            {Object.entries(FUNCTIONS).map(([name, fn]) => {
              const signatureEnd = fn.hint.indexOf(")") + 1;
              return (
                <div key={name}>
                  <code className="text-fg">{fn.hint.slice(0, signatureEnd)}</code>
                  {fn.hint.slice(signatureEnd)}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </form>
  );
}
