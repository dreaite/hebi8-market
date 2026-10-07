"use client";

import { useState, useTransition } from "react";
import { setUsageLimits } from "@/app/actions";
import { USAGE_LIMITS, type UsageLimits } from "@/lib/config";

const KINDS = Object.keys(USAGE_LIMITS) as (keyof UsageLimits)[];

/** The owner's optional daily limits; empty means no notification for that one. */
export function UsageLimitsForm({ initial }: { initial: UsageLimits }) {
  const [values, setValues] = useState({ visitors: initial.visitors?.toString() ?? "", limited: initial.limited?.toString() ?? "" });
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = (k: keyof UsageLimits) => values[k].trim() !== "" && !/^[1-9]\d*$/.test(values[k].trim());

  const save = () =>
    startTransition(async () => {
      const parse = (v: string) => (v.trim() ? Number(v.trim()) : null);
      const result = await setUsageLimits({ visitors: parse(values.visitors), limited: parse(values.limited) });
      setStatus(result.ok ? "已保存" : `保存失败：${result.error}`);
    });

  return (
    <form
      className="flex flex-wrap items-end gap-3 px-3 py-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      {KINDS.map((k) => (
        <label key={k} className="flex flex-col gap-1">
          <span className="text-muted">{USAGE_LIMITS[k]}</span>
          <input
            className="input tabular w-32"
            inputMode="numeric"
            placeholder="不提醒"
            value={values[k]}
            aria-invalid={invalid(k)}
            onChange={(e) => {
              setValues((v) => ({ ...v, [k]: e.target.value }));
              setStatus(null);
            }}
          />
        </label>
      ))}
      <button type="submit" className="btn btn-secondary" disabled={pending || KINDS.some(invalid)}>
        保存
      </button>
      <span className="text-muted">{pending ? "保存中…" : status}</span>
    </form>
  );
}
