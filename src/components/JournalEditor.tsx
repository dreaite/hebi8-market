"use client";

import { saveJournal } from "@/app/actions";
import { draftTime, statusText, useAutosave } from "@/lib/use-autosave";

export function JournalEditor({ week, initial, savedAt }: { week: string; initial: string; savedAt: number | null }) {
  const { text, setText, status, draft, restoreDraft, discardDraft } = useAutosave({
    storageKey: `hebi8:draft:journal/${week}.md`,
    initial,
    savedAt,
    save: (body) => saveJournal(week, body),
  });

  return (
    <div className="rounded-lg border border-line bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2 text-xs">
        <span className="font-medium">本周 · {week}</span>
        <span className={`text-[11px] ${status.state === "error" ? "text-down" : "text-muted"}`} role="status" title="停止输入 1 秒后自动保存；Ctrl/Cmd+S 立即保存">
          {statusText(status)}
        </span>
      </div>
      {draft && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-1.5 text-[11px]">
          <span className="text-muted">有 {draftTime(draft)} 的未保存草稿，比文件新</span>
          <button onClick={restoreDraft} className="btn btn-secondary">
            恢复
          </button>
          <button onClick={discardDraft} className="btn">
            丢弃
          </button>
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
        autoFocus
        className="min-h-[420px] w-full resize-y bg-transparent p-3 font-mono text-xs leading-5 outline-none"
      />
    </div>
  );
}
