import { partsIn } from "./tz";

const DAY_MS = 86400000;

/** ISO week id such as `2026-W41` for a UTC date. */
export function isoWeekId(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday); // Thursday decides the year
  const week = Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / DAY_MS + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export const isWeekId = (s: string) => /^\d{4}-W\d{2}$/.test(s);

/** Monday of an ISO week, as a UTC date. */
export function weekStart(id: string): Date {
  const [year, week] = id.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * DAY_MS;
  return new Date(monday + (week - 1) * 7 * DAY_MS);
}

export function shiftWeek(id: string, weeks: number): string {
  return isoWeekId(new Date(weekStart(id).getTime() + weeks * 7 * DAY_MS));
}

/** This week according to the wall clock in `tz`. */
export function currentWeekId(tz: string, now = new Date()): string {
  const p = partsIn(now, tz);
  return isoWeekId(new Date(Date.UTC(p.y, p.m - 1, p.d)));
}
