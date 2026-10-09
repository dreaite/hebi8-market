"use client";

import { useEffect } from "react";

/** Overlays open now: the first one locks the page's scroll, the last one closed puts back what it found. */
let open = 0;
let pageStyle = { overflow: "", scrollbarGutter: "" };

/** Keeps the page behind a dialog, drawer or the search from scrolling while `active`. */
export function useScrollLock(active = true) {
  useEffect(() => {
    if (!active) return;
    const html = document.documentElement;
    if (open++ === 0) {
      pageStyle = { overflow: html.style.overflow, scrollbarGutter: html.style.scrollbarGutter };
      // keep the scrollbar's room, so the page does not shift sideways
      if (window.innerWidth > html.clientWidth) html.style.scrollbarGutter = "stable";
      html.style.overflow = "hidden";
    }
    return () => {
      if (--open > 0) return;
      html.style.overflow = pageStyle.overflow;
      html.style.scrollbarGutter = pageStyle.scrollbarGutter;
    };
  }, [active]);
}
