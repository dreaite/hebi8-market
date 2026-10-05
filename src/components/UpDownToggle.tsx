"use client";

import { useEffect, useState } from "react";
import { UPDOWN_EVENT } from "@/lib/prefs";

type Convention = "green-up" | "red-up";

export function UpDownToggle() {
  const [mode, setMode] = useState<Convention>("green-up");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync with the attribute set by the head script
    setMode(document.documentElement.dataset.updown === "red-up" ? "red-up" : "green-up");
  }, []);

  const toggle = () => {
    const next: Convention = mode === "green-up" ? "red-up" : "green-up";
    setMode(next);
    if (next === "red-up") document.documentElement.dataset.updown = "red-up";
    else delete document.documentElement.dataset.updown;
    try {
      localStorage.setItem("hebi8:updown", next);
    } catch {
      // ignore
    }
    window.dispatchEvent(new Event(UPDOWN_EVENT));
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 text-xs text-muted hover:text-fg"
      title="切换涨跌颜色"
    >
      <span className="inline-block h-2 w-2 rounded-full bg-up" />
      涨
      <span className="inline-block h-2 w-2 rounded-full bg-down" />跌
    </button>
  );
}
