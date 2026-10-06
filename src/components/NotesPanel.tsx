"use client";

import { useState } from "react";
import { saveNote } from "@/app/actions";
import { fileKey } from "@/lib/symbols";
import { draftTime, statusText, useAutosave } from "@/lib/use-autosave";

interface NotesPanelProps {
  symbolKey: string;
  note: string | null;
  html: string | null;
  /** mtime of notes/<fileKey>.md, null when there is none */
  savedAt: number | null;
  onClose: () => void;
  closeSeq?: number;
  className?: string;
}

/** The thesis for a symbol: rendered markdown, with a self-saving textarea behind「编辑」. */
export function NotesPanel({ symbolKey, note, html, savedAt, onClose, closeSeq = 0, className = "" }: NotesPanelProps) {
  const [editState, setEditState] = useState({ seq: 0, on: false });
  const editing = editState.seq === closeSeq && editState.on;
  const setEditing = (on: boolean) => setEditState({ seq: closeSeq, on });
  const { text, setText, status, draft, restoreDraft, discardDraft, flush } = useAutosave({
    storageKey: `hebi8:draft:notes/${fileKey(symbolKey)}.md`,
    initial: note ?? "",
    savedAt,
    save: (body) => saveNote(symbolKey, body),
  });

  return (
    <aside className={`flex flex-col rounded-lg border border-line bg-card text-xs ${className}`}>
      <div className="flex items-center gap-3 border-b border-line px-3 py-1.5">
        <span className="font-medium">笔记</span>
        <span className={`flex-1 truncate text-[11px] ${status.state === "error" ? "text-down" : "text-muted"}`}>{editing || status.state !== "saved" ? statusText(status) : ""}</span>
        {editing ? (
          <button
            onClick={() => {
              void flush();
              setEditing(false);
            }}
            className="btn"
          >
            完成
          </button>
        ) : (
          <button onClick={() => setEditing(true)} className="btn">
            编辑
          </button>
        )}
        <button onClick={onClose} className="btn px-1" title="收起" aria-label="收起笔记">
          ×
        </button>
      </div>
      {draft && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-bg px-3 py-1.5 text-[11px]">
          <span className="text-muted">有 {draftTime(draft)} 的未保存草稿</span>
          <button
            onClick={() => {
              restoreDraft();
              setEditing(true);
            }}
            className="btn btn-secondary"
          >
            恢复
          </button>
          <button onClick={discardDraft} className="btn">
            丢弃
          </button>
        </div>
      )}
      {editing ? (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"# 为什么看\n\n…"}
          spellCheck={false}
          autoFocus
          className="min-h-[320px] flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-5 outline-none"
        />
      ) : html ? (
        <div className="md overflow-y-auto p-3" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <button onClick={() => setEditing(true)} className="p-3 text-left text-muted hover:text-fg">
          写下为什么看它
        </button>
      )}
    </aside>
  );
}
