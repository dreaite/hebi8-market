"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { stepGroup, stepSymbol, type ListGroup } from "@/lib/watchlist";

/**
 * Drag to reorder symbols and groups, for the overview table and the chart's watchlist panel.
 * Pointer events rather than HTML5 drag and drop, so it also works with a finger.
 *
 * Rows carry `data-dnd-id` (`g:<group>` a group's header, `s:<key>` a symbol, `e:<group>` the
 * placeholder of an empty group) and `data-dnd-group` (`rowAttrs`); the list's root spreads
 * `rootProps`. A mouse drags a row from anywhere outside a text field or an open menu, and a few
 * pixels of movement tell a drag from a click; a finger drags from the row's `data-dnd-handle`,
 * which also takes ↑ / ↓ from the keyboard.
 */

export type DragSource = { kind: "symbol"; key: string } | { kind: "group"; name: string };
/** Indexes count without the dragged entry, like the Server Actions. */
export type Drop = { kind: "symbol"; key: string; group: string; index: number } | { kind: "group"; name: string; index: number };
/** Where the drop line goes: a row's `data-dnd-id` and which edge of it */
export interface DropMark {
  id: string;
  edge: "before" | "after" | "into";
}

interface Options {
  groups: ListGroup<{ key: string }>[];
  collapsed: string[];
  enabled: boolean;
  onDrop: (drop: Drop) => void;
  /** Unfold a group, so a row moved into it by the keyboard stays in view and keeps focus */
  expand: (group: string) => void;
}

interface Session {
  root: HTMLElement;
  source: DragSource;
  startY: number;
  lastY: number;
  active: boolean;
  drop: Drop | null;
  raf: number;
  /** Removes the window listeners this drag added */
  detach: () => void;
}

const THRESHOLD = 4;
const EDGE = 40;

const sourceOf = (id: string): DragSource | null =>
  id.startsWith("s:") ? { kind: "symbol", key: id.slice(2) } : id.startsWith("g:") ? { kind: "group", name: id.slice(2) } : null;

function rows(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>("[data-dnd-id]")]
    .map((el) => ({ id: el.dataset.dndId!, group: el.dataset.dndGroup!, rect: el.getBoundingClientRect() }))
    .filter((r) => r.rect.height > 0);
}

/** The row under y, or the nearest one above or below the list. */
function rowAt<T extends { rect: DOMRect }>(list: T[], y: number): T | undefined {
  return list.find((r) => y < r.rect.bottom) ?? list.at(-1);
}

function findDrop(root: HTMLElement, y: number, source: DragSource, { groups, collapsed }: Options): { drop: Drop; mark: DropMark } | null {
  const all = rows(root);
  if (source.kind === "group") {
    const names = groups.map((g) => g.name);
    const blocks = names.flatMap((name) => {
      const own = all.filter((r) => r.group === name);
      return own.length ? [{ name, top: own[0].rect.top, last: own.at(-1)!, rect: { bottom: own.at(-1)!.rect.bottom } as DOMRect }] : [];
    });
    const block = rowAt(blocks, y);
    if (!block || block.name === source.name) return null;
    const before = y < (block.top + block.rect.bottom) / 2;
    const index = names.filter((n) => n !== source.name).indexOf(block.name) + (before ? 0 : 1);
    if (index === names.indexOf(source.name)) return null;
    return { drop: { kind: "group", name: source.name, index }, mark: before ? { id: `g:${block.name}`, edge: "before" } : { id: block.last.id, edge: "after" } };
  }
  const row = rowAt(all, y);
  if (!row || row.id === `s:${source.key}`) return null;
  const keys = (groups.find((g) => g.name === row.group)?.items ?? []).map((i) => i.key).filter((k) => k !== source.key);
  let index: number;
  let mark: DropMark;
  if (row.id.startsWith("s:")) {
    const before = y < (row.rect.top + row.rect.bottom) / 2;
    index = keys.indexOf(row.id.slice(2)) + (before ? 0 : 1);
    mark = { id: row.id, edge: before ? "before" : "after" };
  } else if (row.id.startsWith("g:") && !collapsed.includes(row.group) && keys.length > 0) {
    index = 0;
    mark = { id: row.id, edge: "after" };
  } else {
    // a folded group's header or an empty group: to its end
    index = keys.length;
    mark = { id: row.id, edge: "into" };
  }
  const from = groups.find((g) => g.items.some((i) => i.key === source.key));
  if (from?.name === row.group && from.items.findIndex((i) => i.key === source.key) === index) return null;
  return { drop: { kind: "symbol", key: source.key, group: row.group, index }, mark };
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === "auto" || overflowY === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

export function useDragSort(options: Options) {
  const [dragging, setDragging] = useState<DragSource | null>(null);
  const [mark, setMark] = useState<DropMark | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const opts = useRef(options);
  const session = useRef<Session | null>(null);
  const swallowClick = useRef(false);
  useEffect(() => {
    opts.current = options;
  });

  const update = (s: Session, y: number) => {
    s.lastY = y;
    const found = findDrop(s.root, y, s.source, opts.current);
    s.drop = found?.drop ?? null;
    setMark(found?.mark ?? null);
  };

  /** `released`: the pointer is already up; after Esc it is still down and its click comes later */
  const end = (commit: boolean, released: boolean) => {
    const s = session.current;
    if (!s) return;
    session.current = null;
    cancelAnimationFrame(s.raf);
    s.detach();
    document.documentElement.style.removeProperty("cursor");
    setDragging(null);
    setMark(null);
    if (!s.active) return;
    // the click that ends a drag is not a click on the row
    swallowClick.current = true;
    const stop = () => setTimeout(() => (swallowClick.current = false), 0);
    if (released) stop();
    else window.addEventListener("pointerup", stop, { once: true, capture: true });
    if (commit && s.drop) opts.current.onDrop(s.drop);
  };

  const listen = (s: Session) => {
    const onMove = (e: globalThis.PointerEvent) => {
      if (!s.active) {
        if (Math.abs(e.clientY - s.startY) < THRESHOLD) return;
        activate(s);
      }
      e.preventDefault();
      update(s, e.clientY);
    };
    const onUp = () => end(true, true);
    const onCancel = () => end(false, true);
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      end(false, false);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey, true);
    s.detach = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey, true);
    };
  };

  const activate = (s: Session) => {
    s.active = true;
    setDragging(s.source);
    document.documentElement.style.cursor = "grabbing";
    // near the top or bottom edge of the scrolling box, keep scrolling while the pointer rests there
    const scroller = scrollParent(s.root);
    const tick = () => {
      const box = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
      const dy = s.lastY < box.top + EDGE ? -Math.ceil((box.top + EDGE - s.lastY) / 4) : s.lastY > box.bottom - EDGE ? Math.ceil((s.lastY - box.bottom + EDGE) / 4) : 0;
      if (dy) {
        (scroller ?? window).scrollBy(0, dy);
        update(s, s.lastY);
      }
      s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    // a cancelled drag released outside the window never cleared it
    swallowClick.current = false;
    if (!opts.current.enabled || session.current || (e.pointerType === "mouse" && e.button !== 0)) return;
    const target = e.target as HTMLElement;
    const handle = target.closest("[data-dnd-handle]");
    if (!handle && (e.pointerType !== "mouse" || target.closest("input, textarea, select, [role=menu]"))) return;
    const row = target.closest<HTMLElement>("[data-dnd-id]");
    const source = row ? sourceOf(row.dataset.dndId!) : null;
    if (!source) return;
    // no text selection, no native link drag
    if (e.pointerType === "mouse") e.preventDefault();
    const s: Session = { root: e.currentTarget, source, startY: e.clientY, lastY: e.clientY, active: false, drop: null, raf: 0, detach: () => undefined };
    session.current = s;
    listen(s);
    // a finger on the handle starts at once; a mouse waits for a few pixels so a click stays a click
    if (e.pointerType !== "mouse") {
      activate(s);
      update(s, e.clientY);
    }
  };

  // a drag cut short by unmounting leaves no listeners behind
  useEffect(() => () => end(false, true), []);

  const rootProps = {
    "data-dnd-root": "",
    onPointerDown,
    onDragStart: (e: MouseEvent) => e.preventDefault(),
    onClickCapture: (e: MouseEvent) => {
      if (!swallowClick.current) return;
      swallowClick.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };

  /** ↑ / ↓ on a row's handle move it one place; focus follows the row. */
  const onHandleKeyDown = (e: KeyboardEvent<HTMLElement>, source: DragSource) => {
    if ((e.key !== "ArrowUp" && e.key !== "ArrowDown") || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.key === "ArrowUp" ? -1 : 1;
    const { groups } = opts.current;
    let drop: Drop;
    let id: string;
    if (source.kind === "symbol") {
      const to = stepSymbol(groups, source.key, step);
      if (!to) return;
      drop = { kind: "symbol", key: source.key, ...to };
      id = `s:${source.key}`;
      if (opts.current.collapsed.includes(to.group)) opts.current.expand(to.group);
      setAnnouncement(`已移到「${to.group}」第 ${to.index + 1} 位`);
    } else {
      const index = stepGroup(groups, source.name, step);
      if (index === null) return;
      drop = { kind: "group", name: source.name, index };
      id = `g:${source.name}`;
      setAnnouncement(`分组「${source.name}」移到第 ${index + 1} 位`);
    }
    const root = e.currentTarget.closest<HTMLElement>("[data-dnd-root]");
    opts.current.onDrop(drop);
    requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-dnd-id="${CSS.escape(id)}"] [data-dnd-handle]`)?.focus());
  };

  return { dragging, mark, announcement, rootProps, onHandleKeyDown };
}

/** `data-drop` / `data-dragging` for a row, which globals.css turns into the drop line and the dimmed source. */
export function rowAttrs(id: string, group: string, drag: { dragging: DragSource | null; mark: DropMark | null }) {
  const source = drag.dragging;
  const dragged = source && (source.kind === "symbol" ? id === `s:${source.key}` : group === source.name);
  return {
    "data-dnd-id": id,
    "data-dnd-group": group,
    "data-drop": drag.mark?.id === id ? drag.mark.edge : undefined,
    "data-dragging": dragged ? "" : undefined,
  };
}
