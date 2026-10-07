"use client";

import { useEffect, useLayoutEffect, type RefObject } from "react";

/**
 * Where a menu opens: below `bottom`, or above `top` when it does not fit; starting at `x`, or
 * ending there. `trigger` is the button that toggles it: pressing it again closes the menu instead
 * of closing and reopening it.
 */
export interface MenuAnchor {
  x: number;
  top: number;
  bottom: number;
  align: "start" | "end";
  trigger?: HTMLElement;
}

/** Under a「⋯」button, right-aligned with it. */
export function buttonAnchor(button: HTMLElement): MenuAnchor {
  const r = button.getBoundingClientRect();
  return { x: r.right, top: r.top - 2, bottom: r.bottom + 2, align: "end", trigger: button };
}

/** At the pointer, for a right-click; `trigger` is the row's「⋯」, which then closes it. */
export function pointerAnchor(e: { clientX: number; clientY: number }, trigger: HTMLElement): MenuAnchor {
  return { x: e.clientX, top: e.clientY, bottom: e.clientY, align: "start", trigger };
}

/**
 * A `menu fixed` element, open while `at` is set. Fixed to the viewport so no scroll container
 * clips it or grows around it: placed before paint and again when `view` changes its size, at most
 * the viewport's height and scrolling inside past that, its first field or item focused, closed on
 * an outside press, Esc, a scroll outside it or resize.
 */
export function useMenu(ref: RefObject<HTMLElement | null>, at: MenuAnchor | null, view: string, onClose: () => void) {
  useEffect(() => {
    if (!at) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !at.trigger?.contains(t)) onClose();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [ref, at, onClose]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) return;
    el.style.left = "0px";
    el.style.maxHeight = `${window.innerHeight - 16}px`;
    el.style.overflowY = "auto";
    const { width, height } = el.getBoundingClientRect();
    const left = at.align === "end" ? at.x - width : at.x;
    const top = at.bottom + height > window.innerHeight - 8 ? at.top - height : at.bottom;
    el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
  }, [ref, at, view]);

  useEffect(() => {
    if (at) ref.current?.querySelector<HTMLElement>("input, [role=menuitem]")?.focus();
  }, [ref, at, view]);
}
