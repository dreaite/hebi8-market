/** Condition badge: on, newly on this week (dot), or newly off this week (dashed, faded). */
export function Badge({ label, state, title }: { label: string; state: "on" | "fresh" | "off"; title?: string }) {
  return (
    <span className={`badge ${state === "fresh" ? "badge-fresh" : state === "off" ? "badge-off" : ""}`} title={title}>
      {state === "fresh" && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
      {label}
    </span>
  );
}
