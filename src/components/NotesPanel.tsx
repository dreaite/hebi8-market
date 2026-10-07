"use client";

import { useState } from "react";
import { saveNote } from "@/app/actions";
import { fileKey } from "@/lib/symbols";
import { draftKey, draftTime, statusText, useAutosave } from "@/lib/use-autosave";
import { IconClose } from "./chart-icons";
import { LoginButton } from "./UiProvider";

interface NotesPanelProps {
  /** The viewer's vault ('' = root): drafts are kept per person */
  vault: string;
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
export function NotesPanel({ vault, symbolKey, note, html, savedAt, onClose, closeSeq = 0, className = "" }: NotesPanelProps) {
  const [editState, setEditState] = useState({ seq: 0, on: false });
  const editing = editState.seq === closeSeq && editState.on;
  const setEditing = (on: boolean) => setEditState({ seq: closeSeq, on });
  const { text, setText, status, draft, restoreDraft, discardDraft, flush } = useAutosave({
    storageKey: draftKey(vault, `notes/${fileKey(symbolKey)}.md`),
    initial: note ?? "",
    savedAt,
    save: (body) => saveNote(symbolKey, body),
  });

  return (
    <aside className={`flex flex-col bg-card text-xs ${className}`} aria-label="笔记">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3">
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
        <button onClick={onClose} className="tb-btn h-7 min-w-7" title="收起" aria-label="收起笔记">
          <IconClose size={16} />
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
        <div className="md min-h-0 flex-1 overflow-y-auto p-3" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <button onClick={() => setEditing(true)} className="p-3 text-left text-muted hover:text-fg">
          写下为什么看它
        </button>
      )}
    </aside>
  );
}

/** The notes panel for a visitor on a shared instance: the owner's notes stay private. */
export function LoginPrompt({ text, onClose, className = "" }: { text: string; onClose: () => void; className?: string }) {
  return (
    <aside className={`flex flex-col bg-card text-xs ${className}`} aria-label="笔记">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line pr-1 pl-3">
        <span className="flex-1 font-medium">笔记</span>
        <button onClick={onClose} className="tb-btn h-7 min-w-7" title="收起" aria-label="收起笔记">
          <IconClose size={16} />
        </button>
      </div>
      <div className="flex flex-col items-start gap-2 p-3 text-muted">
        <p>{text}</p>
        <LoginButton />
      </div>
    </aside>
  );
}
