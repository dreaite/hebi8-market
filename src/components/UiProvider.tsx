"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addSymbol, removeSymbol } from "@/app/actions";
import type { SearchContext } from "@/lib/search";
import { SymbolSearch, type PickDetail } from "./SymbolSearch";

export interface ToastOptions {
  action?: { label: string; onClick: () => void };
  kind?: "info" | "error";
  /** ms; defaults to 6s, 8s with an action */
  duration?: number;
}

interface UiValue {
  searchCtx: SearchContext;
  openSearch: (query?: string) => void;
  toast: (message: string, opts?: ToastOptions) => void;
}

const UiContext = createContext<UiValue | null>(null);

export function useUi(): UiValue {
  const value = useContext(UiContext);
  if (!value) throw new Error("useUi outside UiProvider");
  return value;
}

export const chartHref = (key: string) => `/chart/${encodeURIComponent(key)}`;

/** Focus is in something that takes typing, so global single-key shortcuts must stay quiet. */
export function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !("tagName" in el)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

interface Toast extends ToastOptions {
  id: number;
  message: string;
}

/** Global search overlay, toasts and the keyboard shortcuts that open the search. */
export function UiProvider({ ctx, children }: { ctx: SearchContext; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState<{ query: string; seq: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const toast = useCallback((message: string, opts: ToastOptions = {}) => {
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-2), { id, message, ...opts }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), opts.duration ?? (opts.action ? 8000 : 6000));
  }, []);

  const openSearch = useCallback((query = "") => {
    setError(null);
    setSearch({ query, seq: ++seq.current });
  }, []);
  const closeSearch = useCallback(() => setSearch(null), []);

  // `/` or Ctrl/Cmd+K anywhere; on a chart, any letter or digit starts a search with it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if ((e.key === "k" && mod) || (e.key === "/" && !mod && !e.altKey)) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (pathname.startsWith("/chart/") && !mod && !e.altKey && /^[a-zA-Z0-9]$/.test(e.key) && !/^[jk]$/.test(e.key)) {
        e.preventDefault();
        openSearch(e.key);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, openSearch]);

  const onPick = async (d: PickDetail) => {
    if (d.inWatchlist) {
      closeSearch();
      router.push(chartHref(d.key));
      return;
    }
    setBusy(true);
    setError(null);
    const result = await addSymbol({ key: d.key, group: d.group, name: d.name !== d.key ? d.name : undefined, alias: d.query });
    setBusy(false);
    if (!result.ok) {
      // already watched under another name: just open it
      if (/已经在/.test(result.error)) {
        closeSearch();
        router.push(chartHref(d.key));
        return;
      }
      setError(result.error);
      return;
    }
    closeSearch();
    router.push(chartHref(d.key));
    router.refresh();
    toast(`已添加到 ${d.group}`, {
      action: {
        label: "撤销",
        onClick: () => {
          void removeSymbol(d.key).then((r) => {
            if (r.ok) {
              toast(`已移除 ${d.name}`);
              router.refresh();
            } else toast(r.error, { kind: "error" });
          });
        },
      },
    });
  };

  const value = useMemo<UiValue>(() => ({ searchCtx: ctx, openSearch, toast }), [ctx, openSearch, toast]);

  return (
    <UiContext.Provider value={value}>
      {children}
      {search && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-3 pt-[12vh]" onMouseDown={closeSearch}>
          <div
            className="w-full max-w-[600px] overflow-hidden rounded-lg border border-line bg-card shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="搜索标的"
          >
            <SymbolSearch key={search.seq} mode="navigate" ctx={ctx} initialQuery={search.query} busy={busy} error={error} onPick={(d) => void onPick(d)} onClose={closeSearch} />
          </div>
        </div>
      )}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-3">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-center gap-3 rounded-md px-3 py-2 text-xs shadow-lg ${t.kind === "error" ? "bg-down text-white" : "bg-fg text-bg"}`}
            >
              <span>{t.message}</span>
              {t.action && (
                <button
                  onClick={() => {
                    t.action?.onClick();
                    setToasts((list) => list.filter((x) => x.id !== t.id));
                  }}
                  className="rounded px-1.5 py-0.5 font-medium underline-offset-2 hover:underline"
                >
                  {t.action.label}
                </button>
              )}
              <button onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))} className="opacity-70 hover:opacity-100" aria-label="关闭">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </UiContext.Provider>
  );
}

/** The header's search box: looks like an input, opens the overlay. */
export function SearchTrigger() {
  const { openSearch } = useUi();
  return (
    <button
      type="button"
      onClick={() => openSearch()}
      className="flex h-[26px] w-full max-w-[320px] items-center gap-2 rounded border border-line bg-bg px-2 text-left text-xs text-muted hover:border-muted"
      aria-label="搜索标的，快捷键 /"
    >
      <span aria-hidden>⌕</span>
      <span className="flex-1 truncate">搜索标的 · 按 /</span>
    </button>
  );
}
