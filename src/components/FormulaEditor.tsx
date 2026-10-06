"use client";

import { useMemo, useState } from "react";
import { compile, FUNCTIONS, SERIES_VARS } from "@/indicators/formula";
import { describeError, FORMULA_EXAMPLES, newFormulaId } from "@/indicators/formula-indicators";
import type { FormulaDef } from "@/lib/config";

/** What the formula may reference on this chart: aliases, and the benchmark if the symbol has one. */
export interface FormulaScope {
  aliases: Record<string, string>;
  bench: string | null;
}

interface FormulaEditorProps {
  /** null creates a new formula */
  initial: FormulaDef | null;
  scope: FormulaScope;
  onSave: (def: FormulaDef) => Promise<string | null>;
  onDelete?: () => Promise<string | null>;
  onClose: () => void;
}

function validate(source: string, scope: FormulaScope): { lines: string[] } | { error: string } {
  try {
    return { lines: compile(source, scope).outputs };
  } catch (err) {
    return { error: describeError(err) };
  }
}

export function FormulaEditor({ initial, scope, onSave, onDelete, onClose }: FormulaEditorProps) {
  const [label, setLabel] = useState(initial?.label ?? "");
  const [source, setSource] = useState(initial?.formula ?? "");
  const [pane, setPane] = useState<FormulaDef["pane"]>(initial?.pane ?? "sub");
  const [showHelp, setShowHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const result = useMemo(() => (source.trim() ? validate(source, scope) : null), [source, scope]);
  const valid = result !== null && "lines" in result && label.trim() !== "";

  const submit = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setServerError(await fn());
    setBusy(false);
  };

  const input = "rounded border border-line bg-bg px-2 text-xs outline-none focus:border-accent";
  return (
    <form
      className="rounded-lg border border-line bg-card p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void submit(() => onSave({ id: initial?.id ?? newFormulaId(), label: label.trim(), formula: source, pane }));
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-muted">
            名称
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="input w-36" autoFocus />
          </label>
          <div className="flex gap-3 text-muted">
            {(["main", "sub"] as const).map((p) => (
              <label key={p} className="flex cursor-pointer items-center gap-1">
                <input type="radio" checked={pane === p} onChange={() => setPane(p)} className="accent-current" />
                {p === "main" ? "叠加在主图" : "单独副图"}
              </label>
            ))}
          </div>
          {initial && <span className="font-mono text-[11px] text-muted">id: {initial.id}</span>}
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
                setSource(ex.formula);
                setPane(ex.pane);
              }}
              className="text-accent hover:underline"
            >
              {ex.label}
            </button>
          ))}
        {serverError && <span className="text-down">{serverError}</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => setShowHelp((v) => !v)} aria-pressed={showHelp} className="btn">
          {showHelp ? "收起语法" : "语法"}
        </button>
        {onDelete && (
          <button type="button" onClick={() => void submit(onDelete)} disabled={busy} className="btn text-down">
            删除
          </button>
        )}
        <button type="button" onClick={onClose} className="btn">
          取消
        </button>
        <button type="submit" disabled={!valid || busy} className="btn btn-primary">
          {busy ? "保存中…" : "保存"}
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
            <div className="mt-2">
              别的标的：<code className="text-fg">close(QQQ)</code>（别名）、<code className="text-fg">close(&quot;yahoo:QQQ&quot;)</code>、
              <code className="text-fg">close(bench)</code>；open / high / low / volume 同理，按本标的交易日对齐
            </div>
            <div className="mt-2">运算：+ - * / ^ 和括号；比较 &gt; &lt; &gt;= &lt;= == !=；逻辑 and or not（结果为 0/1）</div>
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
