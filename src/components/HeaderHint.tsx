"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

/** The dotted underline that marks a header with an explanation. */
export const HINT_LABEL = "underline decoration-dotted decoration-muted/60 underline-offset-[3px]";

const WIDTH = 288;

/**
 * A table header's explanation: a card under the header while it is hovered or focused. Fixed to
 * the viewport, so it neither scrolls a table container nor gets clipped by one, and shifted left
 * when the header is near the right edge.
 */
export function useHeaderHint(content: ReactNode) {
  const id = useId();
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = (e: { currentTarget: HTMLElement }) => {
    const r = e.currentTarget.getBoundingClientRect();
    setAt({ left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)), top: r.bottom });
  };
  const hide = () => setAt(null);

  useEffect(() => {
    if (!at) return;
    const onScroll = () => setAt(null);
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [at]);

  return {
    trigger: { "aria-describedby": id, onMouseEnter: show, onMouseLeave: hide, onFocus: show, onBlur: hide },
    panel: (
      <span
        id={id}
        role="tooltip"
        hidden={!at}
        style={{ ...at, width: WIDTH }}
        className="fixed z-30 flex flex-col gap-1.5 rounded-md border border-line bg-card p-3 text-left text-[11px] font-normal whitespace-pre-line text-fg shadow-lg"
      >
        {content}
      </span>
    ),
  };
}
