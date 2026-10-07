"use client";

import { useEffect, useRef, useState } from "react";
import { DRAW_ICONS } from "./chart-icons";
import { DRAW_GROUPS, type DrawGroup } from "./chart-types";

/** The tool a group's button shows: the active one if it is in the group, else the last one used there. */
export function groupTool(group: DrawGroup, active: string | null, remembered: Record<string, string>): string {
  const names = group.sections.flatMap((s) => s.tools.map((t) => t.name));
  if (active && names.includes(active)) return active;
  const last = remembered[group.id];
  return last && names.includes(last) ? last : names[0];
}

/** One group's menu: section headings, then icon · name · hotkey rows. */
export function GroupMenuItems({ group, active, onPick, hotkeys = true }: { group: DrawGroup; active: string | null; onPick: (tool: string) => void; hotkeys?: boolean }) {
  return group.sections.map((section) => (
    <div key={section.label} role="group" aria-label={section.label}>
      <div className="px-2 pt-2 pb-1 text-[11px] text-muted">{section.label}</div>
      {section.tools.map((t) => {
        const Icon = DRAW_ICONS[t.name];
        return (
          <button
            key={t.name}
            type="button"
            role="menuitemradio"
            aria-checked={t.name === active}
            className={`menu-item flex items-center gap-2 ${t.name === active ? "font-medium" : ""}`}
            onClick={() => onPick(t.name)}
          >
            <Icon />
            <span className="flex-1">{t.label}</span>
            {hotkeys && t.hotkey && <span className="pl-4 text-[11px] text-muted">{t.hotkey}</span>}
          </button>
        );
      })}
    </div>
  ));
}

/**
 * TradingView's left toolbar groups: the button draws with the group's current tool, the arrow
 * on its right edge opens the group's menu beside it, and the last pick stays on the button.
 */
export function DrawToolGroups({ active, remembered, onPick }: { active: string | null; remembered: Record<string, string>; onPick: (tool: string, group: string) => void }) {
  const [open, setOpen] = useState<{ id: string; left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!menuRef.current?.contains(t) && !t.closest?.("[data-group-arrow]")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const openGroup = open ? DRAW_GROUPS.find((g) => g.id === open.id) : undefined;

  return (
    <>
      {DRAW_GROUPS.map((group) => {
        const tool = groupTool(group, active, remembered);
        const Icon = DRAW_ICONS[tool];
        const label = group.sections.flatMap((s) => s.tools).find((t) => t.name === tool);
        const on = Boolean(active) && tool === active;
        return (
          <div key={group.id} className="group/tool relative flex">
            <button
              type="button"
              onClick={() => onPick(tool, group.id)}
              aria-pressed={on}
              className="tb-btn"
              title={label?.hotkey ? `${label.label} · ${label.hotkey}` : label?.label}
              aria-label={label?.label}
            >
              <Icon />
            </button>
            <button
              type="button"
              data-group-arrow
              aria-label={group.label}
              title={group.label}
              aria-haspopup="menu"
              aria-expanded={open?.id === group.id}
              onClick={(e) => {
                if (open?.id === group.id) return setOpen(null);
                const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
                setOpen({ id: group.id, left: r.right + 4, top: r.top });
              }}
              className="absolute top-0 -right-[5px] flex h-full w-[9px] items-center justify-center rounded-sm text-muted opacity-0 group-hover/tool:opacity-100 hover:bg-fg/10 hover:text-fg aria-expanded:opacity-100"
            >
              <svg width="5" height="8" viewBox="0 0 5 8" aria-hidden fill="currentColor">
                <path d="M0 0l5 4-5 4z" />
              </svg>
            </button>
          </div>
        );
      })}
      {open && openGroup && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={openGroup.label}
          className="menu fixed max-h-[calc(100vh-16px)] min-w-[15rem] overflow-y-auto"
          style={{ left: open.left, top: Math.max(8, Math.min(open.top, window.innerHeight - 40 - openGroup.sections.reduce((n, s) => n + 24 + s.tools.length * 32, 0))), right: "auto" }}
        >
          <GroupMenuItems
            group={openGroup}
            active={active}
            onPick={(tool) => {
              onPick(tool, openGroup.id);
              setOpen(null);
            }}
          />
        </div>
      )}
    </>
  );
}
