"use client";

import { useRef, useState } from "react";
import { useMenu, type MenuAnchor } from "./use-menu";

export interface RowMenuProps {
  at: MenuAnchor;
  /** A visitor: only 打开, plus a way to log in and keep a list of their own */
  readOnly: boolean;
  onLogin: () => void;
  name: string;
  group: string;
  groups: string[];
  benchLabel: string | null;
  onOpen: () => void;
  onMove: (group: string) => void;
  onRename: (name: string) => void;
  onBench: (bench: string | null) => void;
  onRemove: () => void;
  /** Opens the alert dialog on this symbol */
  onAddAlert: () => void;
  onClose: () => void;
}

type View = "root" | "move" | "rename" | "bench" | "newGroup";

/** The「⋯」menu of an overview row; also opened by right-clicking the row, at the pointer. */
export function RowMenu({ at, readOnly, onLogin, name, group, groups, benchLabel, onOpen, onMove, onRename, onBench, onRemove, onAddAlert, onClose }: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>("root");
  const [text, setText] = useState("");

  useMenu(ref, at, view, onClose);

  const item = (label: string, onClick: () => void, extra = "") => (
    <button role="menuitem" onClick={onClick} className={`menu-item ${extra}`}>
      {label}
    </button>
  );

  const form = (label: string, placeholder: string, submit: (value: string) => void, hint?: string) => (
    <form
      className="flex flex-col gap-1.5 p-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit(text.trim());
      }}
    >
      <span className="text-[11px] text-muted">{label}</span>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} className="input w-full font-mono" autoFocus />
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={() => setView("root")} className="btn">
          返回
        </button>
        <button type="submit" className="btn btn-primary">
          确定
        </button>
      </div>
    </form>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`${name} 的操作`}
      className="menu fixed"
      style={{ right: "auto" }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {view === "root" && readOnly && (
        <>
          {item("打开", onOpen)}
          {item("登录后整理自己的列表", onLogin, "text-muted")}
        </>
      )}
      {view === "root" && !readOnly && (
        <>
          {item("打开", onOpen)}
          {item("移到分组 ▸", () => setView("move"))}
          {item("改名…", () => {
            setText(name);
            setView("rename");
          })}
          {item(benchLabel ? `设基准（${benchLabel}）…` : "设基准…", () => {
            setText(benchLabel ?? "");
            setView("bench");
          })}
          {item("添加警报…", onAddAlert)}
          {item("移除", onRemove, "text-down")}
        </>
      )}
      {view === "move" && (
        <>
          <div className="px-2 pt-1.5 pb-1 text-[11px] text-muted">移到分组</div>
          {groups
            .filter((g) => g !== group)
            .map((g) => (
              <button key={g} role="menuitem" onClick={() => onMove(g)} className="menu-item">
                {g}
              </button>
            ))}
          {item("新建分组…", () => {
            setText("");
            setView("newGroup");
          })}
          {item("返回", () => setView("root"), "text-muted")}
        </>
      )}
      {view === "newGroup" && form("新分组名", "例如 观察", (v) => v && onMove(v))}
      {view === "rename" && form("显示名称", "留空用数据源名称", (v) => onRename(v))}
      {view === "bench" && form("基准：别名或 key", "SPY / yahoo:^HSI", (v) => onBench(v || null), "留空则清除基准")}
    </div>
  );
}
