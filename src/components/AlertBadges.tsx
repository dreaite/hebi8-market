"use client";

import type { AlertBadge, BadgeState } from "@/lib/alert-view";
import { Badge } from "./Badge";

/** One symbol's alerts on the overview; hovering one shows its definition, clicking opens it. */
export function AlertBadgeList({ badges, onOpen }: { badges: AlertBadge[]; onOpen?: (id: string) => void }) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((b) => (
        <Badge
          key={b.id}
          label={b.label}
          state={b.state}
          title={b.title}
          onClick={
            onOpen &&
            ((e) => {
              // the row and the card are links
              e.preventDefault();
              e.stopPropagation();
              onOpen(b.id);
            })
          }
        />
      ))}
    </div>
  );
}

const LEGEND: { state: BadgeState; label: string; text: string }[] = [
  { state: "fresh", label: "本周新触发", text: "这周触发过" },
  { state: "on", label: "已触发", text: "价格警报触发过，或条件现在成立（成立中）" },
  { state: "idle", label: "未触发", text: "还没有触发" },
  { state: "stopped", label: "已停止", text: "暂停了" },
];

/** The 警报 column header: hovering or focusing the「?」shows what the badge styles mean. */
export function AlertLegend({ readOnly }: { readOnly: boolean }) {
  return (
    <span className="group/legend relative flex h-7 items-center gap-1 px-2">
      警报
      <button type="button" aria-label="警报徽标说明" aria-describedby="alert-legend" className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-line text-[9px] leading-none hover:text-fg focus-visible:text-fg">
        ?
      </button>
      <span
        id="alert-legend"
        role="tooltip"
        className="invisible absolute top-full left-0 z-30 flex w-72 flex-col gap-1.5 rounded-md border border-line bg-card p-3 text-left text-[11px] text-fg shadow-lg group-focus-within/legend:visible group-hover/legend:visible"
      >
        {LEGEND.map((l) => (
          <span key={l.state} className="flex items-center gap-2">
            <span className="w-[5.5rem] shrink-0">
              <Badge label={l.label} state={l.state} />
            </span>
            <span className="text-muted">{l.text}</span>
          </span>
        ))}
        <span className="mt-1 text-muted">
          {readOnly
            ? "警报是各人自己的：登录后在行菜单「添加警报…」里建，用你起的名字显示在这里。"
            : "名字是你起的。悬停徽标看定义，点它编辑；行菜单「添加警报…」新建。对「全部自选」的警报只在成立的标的上显示。"}
        </span>
      </span>
    </span>
  );
}
