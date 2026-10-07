import type { MouseEvent } from "react";
import type { BadgeState } from "@/lib/alert-view";

const CLASS: Record<BadgeState, string> = { fresh: "badge-fresh", on: "badge-on", idle: "", stopped: "badge-stopped" };

/**
 * Alert badge: newly fired this week (tinted, dot), fired or holding (solid), not fired (muted),
 * stopped (dashed, faded). With `onClick` it is a button that opens the alert.
 */
export function Badge({ label, state, title, onClick }: { label: string; state: BadgeState; title?: string; onClick?: (e: MouseEvent<HTMLButtonElement>) => void }) {
  const content = (
    <>
      {state === "fresh" && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      <span className="truncate">{label}</span>
    </>
  );
  const className = `badge ${CLASS[state]}`;
  if (!onClick) {
    return (
      <span className={className} title={title}>
        {content}
      </span>
    );
  }
  return (
    <button type="button" className={`${className} badge-button`} title={title} onClick={onClick}>
      {content}
    </button>
  );
}
