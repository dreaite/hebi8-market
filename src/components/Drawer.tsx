"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { HelpInfo } from "@/lib/help-info";
import { IconClose, IconExternal } from "./chart-icons";
import { isEditable } from "./UiProvider";
import { useScrollLock } from "./use-scroll-lock";

/**
 * The right-hand drawer (a bottom sheet on narrow screens) that help / feedback and 登录 /
 * 通知设置 open in. Esc, `?` and a click outside close it; its keys never reach the page behind, nor does it scroll.
 */
export function Drawer({ label, header, onClose, children }: { label: string; header: ReactNode; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLElement>(null);
  useScrollLock();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // keys stay inside the panel: the chart's Space / arrows / letters must not fire behind it
  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "?" && !isEditable(e.target))) {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/25" onMouseDown={onClose}>
      <aside
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="help-panel absolute flex flex-col overflow-hidden border-line bg-card shadow-xl outline-none"
      >
        <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-2 pl-3">
          {header}
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="tb-btn" aria-label="关闭" title="关闭 (Esc)">
            <IconClose />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs">{children}</div>
      </aside>
    </div>
  );
}

/** `/api/help`: login state, feedback setup and who may set the bot. Local reads only. */
export function useHelpInfo() {
  const [info, setInfo] = useState<HelpInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setInfo(await request<HelpInfo>("/api/help", "GET"));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- state is set after the fetch resolves
    void reload();
  }, [reload]);
  return { info, error, reload };
}

export function Section({ title, className = "", children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={`mb-5 ${className}`}>
      <h3 className="mb-2 text-[11px] font-medium tracking-wide text-muted">{title}</h3>
      {children}
    </section>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
      {children}
      <IconExternal size={12} />
    </a>
  );
}

export async function request<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json as T;
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
