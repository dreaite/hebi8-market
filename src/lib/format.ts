import { pricePrecision } from "./stats";

export function fmtPrice(value: number, precision = pricePrecision(value)): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

export function fmtPct(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct).toFixed(digits)}%`;
}

export function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

export function fmtAgo(ms: number | null): string {
  if (!ms) return "从未同步";
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "刚刚同步";
  if (minutes < 60) return `${minutes} 分钟前同步`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时前同步`;
  return `${Math.round(hours / 24)} 天前同步`;
}

/** Tailwind text color for a signed change. */
export function changeColor(value: number | null | undefined): string {
  if (value == null || value === 0) return "text-muted";
  return value > 0 ? "text-up" : "text-down";
}
