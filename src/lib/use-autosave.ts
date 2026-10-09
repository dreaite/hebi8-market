"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ActionResult } from "@/app/actions";

export type SaveStatus = { state: "saved"; at: number | null } | { state: "saving" } | { state: "dirty" } | { state: "error"; message: string };

export interface AutosaveOptions {
  /** localStorage key of the draft, e.g. `hebi8:draft:notes/yahoo_NVDA.md` */
  storageKey: string;
  initial: string;
  /** mtime (ms) of the file on disk, null when it does not exist yet */
  savedAt: number | null;
  save: (text: string) => Promise<ActionResult>;
  delay?: number;
}

/**
 * The localStorage key of a draft. On a shared instance drafts belong to a vault, so one person
 * never restores another's; the root vault keeps the original keys so existing drafts survive.
 */
export const draftKey = (vault: string, file: string) => (vault ? `hebi8:draft:users/${vault}/${file}` : `hebi8:draft:${file}`);

export interface Draft {
  text: string;
  at: number;
}

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/**
 * Text that saves itself: a debounced save after typing stops, Ctrl/Cmd+S right away, a
 * beforeunload guard while dirty, and a localStorage draft in case the save never lands.
 */
export function useAutosave({ storageKey, initial, savedAt, save, delay = 1000 }: AutosaveOptions) {
  const [text, setTextState] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>({ state: "saved", at: savedAt });
  const [dismissed, setDismissed] = useState(false);
  const latest = useRef(initial);
  const onDisk = useRef(initial);
  const saveRef = useRef(save);
  const flushRef = useRef<() => Promise<void>>(async () => undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef<Promise<void> | null>(null);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // the draft is read through an external store so server and client render the same markup first
  const rawDraft = useSyncExternalStore(subscribe, () => localStorage.getItem(storageKey), () => null);
  const draft = useMemo<Draft | null>(() => {
    if (!rawDraft || dismissed) return null;
    try {
      const d = JSON.parse(rawDraft) as Draft;
      return typeof d.text === "string" && d.text !== initial && d.at > (savedAt ?? 0) ? d : null;
    } catch {
      return null;
    }
  }, [rawDraft, dismissed, initial, savedAt]);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) return;
    const value = latest.current;
    if (value === onDisk.current) return;
    setStatus({ state: "saving" });
    inflight.current = saveRef
      .current(value)
      .then((result) => {
        inflight.current = null;
        if (!result.ok) {
          setStatus({ state: "error", message: result.error });
          return;
        }
        onDisk.current = value;
        setSaved(value);
        if (latest.current === value) {
          localStorage.removeItem(storageKey);
          setStatus({ state: "saved", at: Date.now() });
        } else {
          // typing went on while saving: the newer text goes out next
          void flushRef.current();
        }
      })
      .catch((err: Error) => {
        inflight.current = null;
        setStatus({ state: "error", message: err.message });
      });
    await inflight.current;
  }, [storageKey]);
  useEffect(() => {
    flushRef.current = flush;
  }, [flush]);

  const setText = useCallback(
    (next: string) => {
      latest.current = next;
      setTextState(next);
      if (next === onDisk.current) {
        localStorage.removeItem(storageKey);
        setStatus((s) => (s.state === "dirty" ? { state: "saved", at: null } : s));
        clearTimeout(timer.current);
        return;
      }
      setStatus({ state: "dirty" });
      try {
        localStorage.setItem(storageKey, JSON.stringify({ text: next, at: Date.now() } satisfies Draft));
      } catch {
        // storage full or disabled: the debounced save still runs
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [storageKey, delay, flush],
  );

  // Ctrl/Cmd+S saves now (with Shift or Alt it is the chart's snapshot keys); leaving the page while dirty asks first
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (latest.current !== onDisk.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
      clearTimeout(timer.current);
    };
  }, [flush]);

  const restoreDraft = () => {
    if (!draft) return;
    setDismissed(true);
    setText(draft.text);
  };
  const discardDraft = () => {
    localStorage.removeItem(storageKey);
    setDismissed(true);
  };

  return { text, setText, status, dirty: text !== saved, flush, draft, restoreDraft, discardDraft };
}

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 5);

export function statusText(status: SaveStatus): string {
  switch (status.state) {
    case "saved":
      return status.at ? `已保存 ${clock(status.at)}` : "已保存";
    case "saving":
      return "保存中…";
    case "dirty":
      return "未保存";
    case "error":
      return `保存失败：${status.message}`;
  }
}

export function draftTime(draft: Draft): string {
  return clock(draft.at);
}
