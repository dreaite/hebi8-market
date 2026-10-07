"use client";

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { addSymbol, removeSymbol } from "@/app/actions";
import type { SearchContext } from "@/lib/search";
import { IconHelp } from "./chart-icons";
import { HelpPanel, type HelpTab } from "./HelpPanel";
import { SymbolSearch, type PickDetail } from "./SymbolSearch";

export interface ToastOptions {
  action?: { label: string; onClick: () => void };
  kind?: "info" | "error";
  /** ms; defaults to 6s, 8s with an action or link */
  duration?: number;
  /** The message is a link (opens in a new tab), e.g. to the issue just created */
  href?: string;
}

interface UiValue {
  searchCtx: SearchContext;
  openSearch: (query?: string) => void;
  toast: (message: string, opts?: ToastOptions) => void;
  /** Open the help drawer, on a given tab or the last one used */
  openHelp: (tab?: HelpTab) => void;
  /** 登录: the help drawer's GitHub device flow, started right away */
  login: () => void;
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

/** Global search overlay, help drawer, toasts and the keyboard shortcuts that open them. */
export function UiProvider({ ctx, readOnly, children }: { ctx: SearchContext; readOnly: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [search, setSearch] = useState<{ query: string; seq: number } | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<{ tab: HelpTab | null; notice: string | null; seq: number; autoLogin?: boolean } | null>(null);
  const seq = useRef(0);

  const toast = useCallback((message: string, opts: ToastOptions = {}) => {
    const id = ++seq.current;
    setToasts((list) => [...list.slice(-2), { id, message, ...opts }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), opts.duration ?? (opts.action || opts.href ? 8000 : 6000));
  }, []);

  const openSearch = useCallback((query = "") => {
    setError(null);
    setSearch({ query, seq: ++seq.current });
  }, []);
  const closeSearch = useCallback(() => setSearch(null), []);

  const openHelp = useCallback((tab?: HelpTab, notice: string | null = null) => {
    setSearch(null);
    setHelp({ tab: tab ?? null, notice, seq: ++seq.current });
  }, []);
  const closeHelp = useCallback(() => setHelp(null), []);
  const login = useCallback(() => {
    setSearch(null);
    setHelp({ tab: "notify", notice: null, seq: ++seq.current, autoLogin: true });
  }, []);

  // `?help=feedback|project|notify` opens the drawer (a link to the feedback form), then leaves the URL
  useEffect(() => {
    const url = new URL(window.location.href);
    const tab = url.searchParams.get("help");
    if (tab !== "feedback" && tab !== "project" && tab !== "notify") return;
    url.searchParams.delete("help");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query only exists in the browser URL
    openHelp(tab);
  }, [pathname, openHelp]);

  // `/` or Ctrl/Cmd+K anywhere; on a chart, any letter or digit starts a search with it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "?" && !mod && !e.altKey) {
        e.preventDefault();
        setHelp((h) => (h ? null : { tab: null, notice: null, seq: ++seq.current }));
        return;
      }
      if ((e.key === "k" && mod) || (e.key === "/" && !mod && !e.altKey)) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (pathname.startsWith("/chart/") && !mod && !e.altKey && /^[a-zA-Z0-9]$/.test(e.key)) {
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

  const value = useMemo<UiValue>(
    () => ({ searchCtx: ctx, openSearch, toast, openHelp: (tab?: HelpTab) => openHelp(tab), login }),
    [ctx, openSearch, toast, openHelp, login],
  );

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
            <SymbolSearch key={search.seq} mode="navigate" ctx={ctx} readOnly={readOnly} initialQuery={search.query} busy={busy} error={error} onPick={(d) => void onPick(d)} onClose={closeSearch} />
          </div>
        </div>
      )}
      {help && <HelpPanel key={help.seq} tab={help.tab} notice={help.notice} autoLogin={help.autoLogin ?? false} onClose={closeHelp} toast={toast} />}
      {toasts.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex flex-col items-center gap-2 px-3">
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className={`pointer-events-auto flex items-center gap-3 rounded-md px-3 py-2 text-xs shadow-lg ${t.kind === "error" ? "bg-down text-white" : "bg-fg text-bg"}`}
            >
              {t.href ? (
                <a href={t.href} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-2">
                  {t.message}
                </a>
              ) : (
                <span>{t.message}</span>
              )}
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

/** The header's round "?" button: help, shortcuts and feedback. */
export function HelpButton() {
  const { openHelp } = useUi();
  return (
    <button
      type="button"
      onClick={() => openHelp()}
      className="flex h-[26px] w-[26px] items-center justify-center rounded-full text-muted hover:bg-fg/[0.07] hover:text-fg"
      aria-label="帮助与反馈，快捷键 ?"
      title="帮助与反馈 · ?"
    >
      <IconHelp size={18} />
    </button>
  );
}

/** 登录 as a button anywhere (notes, review): opens the help drawer's device flow. */
export function LoginButton() {
  const { login } = useUi();
  return (
    <button type="button" onClick={login} className="btn btn-secondary">
      登录
    </button>
  );
}

/** The header's identity on a shared instance: 登录, or the avatar and login with a menu. */
export function Account({ user, enabled, owner = false }: { user: { login: string; avatarUrl: string } | null; enabled: boolean; owner?: boolean }) {
  const { login, openHelp } = useUi();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) {
    return enabled ? (
      <button type="button" onClick={login} className="btn">
        登录
      </button>
    ) : null;
  }
  const logout = async () => {
    setOpen(false);
    await fetch("/api/github/logout", { method: "POST" }).catch(() => undefined);
    router.refresh();
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" aria-label={user.login} className="btn gap-1.5" title={`已登录为 ${user.login}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- GitHub avatar, no optimisation wanted */}
        <img src={`${user.avatarUrl}${user.avatarUrl.includes("?") ? "&" : "?"}s=40`} alt="" width={18} height={18} className="rounded-full" />
        {/* narrow screens: the avatar alone, so the header never scrolls sideways */}
        <span className="hidden max-w-[10rem] truncate sm:inline">{user.login}</span>
      </button>
      {open && (
        <div role="menu" aria-label="账号" className="menu mt-1">
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              openHelp("notify");
            }}
            className="menu-item"
          >
            通知设置
          </button>
          {owner && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                router.push("/usage");
              }}
              className="menu-item"
            >
              使用情况
            </button>
          )}
          <button role="menuitem" onClick={() => void logout()} className="menu-item">
            退出
          </button>
        </div>
      )}
    </div>
  );
}
