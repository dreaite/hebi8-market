"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconClose } from "./chart-icons";

/** TradingView-style modal: title bar with ×, closes on backdrop click (Esc is handled by the page). */
export function Dialog({ title, onClose, children, className = "max-w-[560px]" }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 px-3 pt-[8vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`flex max-h-[84vh] w-full flex-col overflow-hidden rounded-lg border border-line bg-card shadow-xl ${className}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4">
          <span className="text-sm font-medium">{title}</span>
          <button type="button" onClick={onClose} className="tb-btn" aria-label="关闭" title="关闭 (Esc)">
            <IconClose />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * A toolbar button with a menu under it. The menu is fixed-positioned from the button's rect, so it
 * is not clipped by a horizontally scrolling toolbar; it closes on outside click, Esc, scroll or resize.
 */
export function Dropdown({
  label,
  title,
  pressed,
  className = "tb-btn",
  menuClassName = "min-w-[11rem]",
  children,
}: {
  label: ReactNode;
  title: string;
  pressed?: boolean;
  className?: string;
  menuClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !buttonRef.current?.contains(t)) setPos(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPos(null);
    };
    const onMove = () => setPos(null);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [pos]);
  // a menu wider than the room right of its button moves left, so it stays on screen
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!pos || !el) return;
    const over = el.getBoundingClientRect().right - (window.innerWidth - 4);
    if (over > 0) el.style.left = `${Math.max(4, pos.left - over)}px`;
  }, [pos]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={Boolean(pos)}
        aria-pressed={pressed}
        onClick={() => {
          if (pos) return close();
          const r = buttonRef.current!.getBoundingClientRect();
          setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - 200)), top: r.bottom + 4 });
        }}
      >
        {label}
      </button>
      {pos && (
        <div ref={menuRef} role="menu" className={`menu fixed ${menuClassName}`} style={{ left: pos.left, top: pos.top, right: "auto" }}>
          {children(close)}
        </div>
      )}
    </>
  );
}
