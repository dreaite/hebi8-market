"use client";

import { useState, useTransition } from "react";
import { saveNote } from "@/app/actions";

interface NotesPanelProps {
  symbolKey: string;
  note: string | null;
  html: string | null;
  onClose: () => void;
}

/** The thesis for a symbol: rendered markdown, with a textarea behind「编辑」. */
export function NotesPanel({ symbolKey, note, html, onClose }: NotesPanelProps) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const result = await saveNote(symbolKey, body);
      if (result.ok) {
        setEditing(false);
        setError(null);
      } else setError(result.error);
    });

  return (
    <aside className="flex w-80 shrink-0 flex-col rounded-lg border border-line bg-card text-xs">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="font-medium">笔记</span>
        <div className="flex gap-3 text-muted">
          {editing ? (
            <>
              <button onClick={save} disabled={saving} className="text-accent disabled:opacity-50">
                {saving ? "保存中…" : "保存"}
              </button>
              <button
                onClick={() => {
                  setBody(note ?? "");
                  setEditing(false);
                }}
                className="hover:text-fg"
              >
                取消
              </button>
            </>
          ) : (
            <button onClick={() => setEditing(true)} className="hover:text-fg">
              编辑
            </button>
          )}
          <button onClick={onClose} className="hover:text-fg" title="收起">
            ×
          </button>
        </div>
      </div>
      {editing ? (
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={"# 为什么看\n\n…"}
          spellCheck={false}
          autoFocus
          className="min-h-[360px] flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 outline-none"
        />
      ) : html ? (
        <div className="md overflow-y-auto p-3" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <button onClick={() => setEditing(true)} className="p-3 text-left text-muted hover:text-fg">
          写下为什么看它
        </button>
      )}
      {error && <p className="px-3 pb-2 text-down">{error}</p>}
    </aside>
  );
}
