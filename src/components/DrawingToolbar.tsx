"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { LineDash } from "./drawing-style";
import { Dialog } from "./Dialog";
import { DRAW_ICONS, IconAlarm, IconCaret, IconEye, IconGear, IconLineDash, IconLineWidth, IconLock, IconText, IconTrash } from "./chart-icons";
import { DRAW_TOOLS, TEXT_DRAWINGS } from "./chart-types";

/** What the floating toolbar and the settings dialog show of the selected drawing. */
export interface DrawingInfo {
  name: string;
  color: string;
  size: number;
  dash: LineDash;
  textSize: number;
  text: string;
  locked: boolean;
  values: number[];
}

export interface DrawingChange {
  color?: string;
  size?: number;
  dash?: LineDash;
  textSize?: number;
  text?: string;
  values?: number[];
}

/** TradingView's colour picker: a row of hues and a row of greys. */
const PALETTE = [
  ["#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63"],
  ["#ffffff", "#d1d4dc", "#b2b5be", "#9598a1", "#787b86", "#5d606b", "#434651", "#2a2e39", "#131722", "#000000"],
];
const WIDTHS = [1, 2, 3, 4];
const DASHES: { dash: LineDash; label: string }[] = [
  { dash: "solid", label: "实线" },
  { dash: "dashed", label: "虚线" },
  { dash: "dotted", label: "点线" },
];
const TEXT_SIZES = [10, 12, 14, 16, 20, 24, 28, 32, 40];

export const toolLabel = (name: string) => DRAW_TOOLS.find((t) => t.name === name)?.label ?? name;

function Swatches({ value, onPick }: { value: string; onPick: (c: string) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {PALETTE.map((row, i) => (
        <div key={i} className="flex gap-1">
          {row.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              aria-label={c}
              aria-pressed={c.toLowerCase() === value.toLowerCase()}
              onClick={() => onPick(c)}
              className="h-5 w-5 rounded-sm border border-line aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-offset-1"
              style={{ background: c }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

type Popover = "color" | "width" | "dash" | "textSize";

/**
 * TradingView's floating toolbar for the selected drawing: colour, width, dash (or font size and
 * the text for text drawings), settings, an alert for price lines, lock, hide and delete.
 */
export function DrawingToolbar({
  info,
  canAlert,
  onChange,
  onEditText,
  onSettings,
  onAlert,
  onLock,
  onHide,
  onDelete,
}: {
  info: DrawingInfo;
  canAlert: boolean;
  onChange: (change: DrawingChange) => void;
  onEditText: () => void;
  onSettings: () => void;
  onAlert: () => void;
  onLock: () => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState<Popover | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isText = TEXT_DRAWINGS.has(info.name);
  const Icon = DRAW_ICONS[info.name];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (p: Popover) => setOpen((cur) => (cur === p ? null : p));
  const pick = (change: DrawingChange) => {
    onChange(change);
    setOpen(null);
  };
  const button = (key: string, title: string, child: ReactNode, onClick: () => void, extra: Partial<{ pressed: boolean; expanded: boolean }> = {}) => (
    <button key={key} type="button" className="tb-btn" title={title} aria-label={title} aria-pressed={extra.pressed} aria-expanded={extra.expanded} onClick={onClick}>
      {child}
    </button>
  );

  return (
    <div
      ref={ref}
      className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-line bg-card p-0.5 shadow-lg"
      role="toolbar"
      aria-label="绘图工具栏"
      // keep the chart's own mousedown (which would deselect) out of it
      onMouseDown={(e) => e.stopPropagation()}
    >
      {Icon && (
        <span className="flex h-[30px] items-center px-1.5 text-muted" title={toolLabel(info.name)}>
          <Icon />
        </span>
      )}
      <span className="tb-sep" />
      {button(
        "color",
        isText ? "文字颜色" : "线条颜色",
        <span className="flex flex-col items-center gap-0.5">
          {isText ? <IconText size={14} /> : <IconLineWidth size={14} width={2} />}
          <span className="h-1 w-4 rounded-sm" style={{ background: info.color }} />
        </span>,
        () => toggle("color"),
        { expanded: open === "color" },
      )}
      {isText
        ? [
            button("size", "字号", <span className="flex items-center gap-0.5 text-xs">{info.textSize}<IconCaret className="text-muted" /></span>, () => toggle("textSize"), { expanded: open === "textSize" }),
            button("edit", "编辑文字（双击文字也可以）", <IconText />, onEditText),
          ]
        : [
            button("width", "线宽", <span className="flex items-center gap-0.5 text-xs"><IconLineWidth width={Math.min(3, info.size)} />{info.size}px</span>, () => toggle("width"), { expanded: open === "width" }),
            button("dash", "线型", <IconLineDash dash={info.dash} />, () => toggle("dash"), { expanded: open === "dash" }),
          ]}
      {button("settings", "设置", <IconGear />, onSettings)}
      {canAlert && button("alert", "添加警报", <IconAlarm />, onAlert)}
      <span className="tb-sep" />
      {button("lock", info.locked ? "解锁" : "锁定", <IconLock open={!info.locked} />, onLock, { pressed: info.locked })}
      {button("hide", "隐藏（左侧「显示所有绘图」恢复）", <IconEye off />, onHide)}
      {button("delete", "删除 · Del", <IconTrash />, onDelete)}

      {open && (
        <div className="menu absolute top-full left-1/2 mt-1 -translate-x-1/2 p-2" style={{ right: "auto", minWidth: 0 }} role="menu">
          {open === "color" && <Swatches value={info.color} onPick={(color) => pick({ color })} />}
          {open === "width" &&
            WIDTHS.map((w) => (
              <button key={w} type="button" role="menuitemradio" aria-checked={w === info.size} className={`menu-item flex items-center gap-2 ${w === info.size ? "font-medium" : ""}`} onClick={() => pick({ size: w })}>
                <IconLineWidth width={w} /> {w}px
              </button>
            ))}
          {open === "dash" &&
            DASHES.map((d) => (
              <button key={d.dash} type="button" role="menuitemradio" aria-checked={d.dash === info.dash} className={`menu-item flex items-center gap-2 ${d.dash === info.dash ? "font-medium" : ""}`} onClick={() => pick({ dash: d.dash })}>
                <IconLineDash dash={d.dash} /> {d.label}
              </button>
            ))}
          {open === "textSize" &&
            TEXT_SIZES.map((s) => (
              <button key={s} type="button" role="menuitemradio" aria-checked={s === info.textSize} className={`menu-item ${s === info.textSize ? "font-medium" : ""}`} onClick={() => pick({ textSize: s })}>
                {s}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

/** The 设置 dialog of a drawing: style, its text (text drawings) and the price of each point. */
export function DrawingSettings({ info, precision, onApply, onClose }: { info: DrawingInfo; precision: number; onApply: (change: DrawingChange) => void; onClose: () => void }) {
  const isText = TEXT_DRAWINGS.has(info.name);
  const [color, setColor] = useState(info.color);
  const [size, setSize] = useState(info.size);
  const [dash, setDash] = useState(info.dash);
  const [textSize, setTextSize] = useState(info.textSize);
  const [text, setText] = useState(info.text);
  const [values, setValues] = useState(info.values.map((v) => v.toFixed(precision)));
  const row = "flex items-center justify-between gap-4";

  return (
    <Dialog title={toolLabel(info.name)} onClose={onClose} className="max-w-[400px]">
      <form
        className="flex flex-col gap-3 overflow-y-auto p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          const nums = values.map(Number);
          onApply({ color, ...(isText ? { textSize, text } : { size, dash }), ...(nums.every(Number.isFinite) ? { values: nums } : {}) });
        }}
      >
        <div className={row}>
          <span className="text-muted">颜色</span>
          <Swatches value={color} onPick={setColor} />
        </div>
        {isText ? (
          <>
            <label className={row}>
              <span className="text-muted">字号</span>
              <select className="input h-7 w-24" value={textSize} onChange={(e) => setTextSize(Number(e.target.value))}>
                {TEXT_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">文字</span>
              <textarea className="input min-h-20 py-1" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          </>
        ) : (
          <>
            <div className={row}>
              <span className="text-muted">线宽</span>
              <span className="flex gap-1">
                {WIDTHS.map((w) => (
                  <button key={w} type="button" className="tb-btn h-7 px-2 text-xs" aria-pressed={w === size} onClick={() => setSize(w)}>
                    {w}px
                  </button>
                ))}
              </span>
            </div>
            <div className={row}>
              <span className="text-muted">线型</span>
              <span className="flex gap-1">
                {DASHES.map((d) => (
                  <button key={d.dash} type="button" className="tb-btn h-7 px-2" aria-pressed={d.dash === dash} title={d.label} aria-label={d.label} onClick={() => setDash(d.dash)}>
                    <IconLineDash dash={d.dash} />
                  </button>
                ))}
              </span>
            </div>
          </>
        )}
        {values.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-muted">坐标（价格）</legend>
            {values.map((v, i) => (
              <label key={i} className={row}>
                <span className="text-xs text-muted">点 {i + 1}</span>
                <input
                  className="input h-7 w-36 font-mono"
                  inputMode="decimal"
                  value={v}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setValues(values.map((x, j) => (j === i ? e.target.value : x)))}
                />
              </label>
            ))}
          </fieldset>
        )}
        <div className="-mx-4 mt-1 flex justify-end gap-2 border-t border-line px-4 pt-3">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="btn btn-primary">
            确定
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** Text width in `ch`, CJK and other wide characters counting double. */
const widthOf = (line: string) => [...line].reduce((n, ch) => n + (/[\u1100-\uffff]/.test(ch) ? 2 : 1), 0);

/** Typing a text drawing in place, TradingView style: Enter commits, Shift+Enter breaks the line, Esc cancels. */
export function TextEditor({
  x,
  y,
  center,
  size,
  color,
  initial,
  onCommit,
  onCancel,
}: {
  x: number;
  y: number;
  /** Centred above (x, y), like a 注释's label; otherwise the top-left corner is at (x, y) */
  center: boolean;
  size: number;
  color: string;
  initial: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(text);
    else onCancel();
  };
  const rows = Math.max(1, text.split("\n").length);
  return (
    <textarea
      autoFocus
      aria-label="绘图文字"
      placeholder="文字"
      value={text}
      rows={rows}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // the page's Esc would also leave the drawing tool and blur (= commit) this box
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(true);
        }
      }}
      className="absolute z-20 resize-none overflow-hidden rounded-sm border border-dashed border-accent bg-card/80 px-0.5 leading-[1.35] outline-none"
      style={{
        left: x,
        top: y,
        transform: center ? "translate(-50%, -100%)" : undefined,
        fontSize: size,
        color,
        width: `${Math.max(6, ...text.split("\n").map(widthOf)) + 1}ch`,
        minWidth: "4ch",
      }}
    />
  );
}
