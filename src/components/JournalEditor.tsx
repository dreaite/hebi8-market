"use client";

import { useState, useTransition } from "react";
import { saveJournal } from "@/app/actions";

export function JournalEditor({ week, initial }: { week: string; initial: string }) {
  const [body, setBody] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const dirty = body !== saved;

  const save = () =>
    startTransition(async () => {
      const result = await saveJournal(week, body);
      if (result.ok) {
        setSaved(body);
        setError(null);
      } else setError(result.error);
    });

  return (
    <div className="rounded-lg border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs">
        <span className="font-medium">本周 · {week}</span>
        <button onClick={save} disabled={saving || !dirty} className="text-accent disabled:opacity-40">
          {saving ? "保存中…" : dirty ? "保存" : "已保存"}
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        spellCheck={false}
        className="min-h-[420px] w-full resize-y bg-transparent p-3 font-mono text-xs leading-5 outline-none"
      />
      {error && <p className="px-3 pb-2 text-xs text-down">{error}</p>}
    </div>
  );
}
