"use client";

import type { AlertBadge, BadgeState } from "@/lib/alert-view";
import { Badge } from "./Badge";
import { HINT_LABEL, useHeaderHint } from "./HeaderHint";

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

/** The 警报 column header: hovering or focusing it shows what the badge styles mean. */
export function AlertLegend({ readOnly }: { readOnly: boolean }) {
  const hint = useHeaderHint(
    <>
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
    </>,
  );
  return (
    <>
      <span tabIndex={0} {...hint.trigger} className="flex h-7 cursor-help items-center px-2">
        <span className={HINT_LABEL}>警报</span>
      </span>
      {hint.panel}
    </>
  );
}
