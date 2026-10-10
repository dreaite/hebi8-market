/**
 * When the unfinished bar of a timeframe closes, for the countdown under the last price (design
 * §5.2), TradingView's way. Pure, shared by the server's tests and the chart.
 */
import type { QuoteSession } from "./sources/types";
import type { Timeframe } from "./symbols";
import { dayOf, partsIn, zonedToUtc, type Parts } from "./tz";

export interface SessionClock {
  /** The last quote's session while it is current, and when that quote was taken (ms) */
  session: QuoteSession | null;
  quotedAt: number | null;
  /** The regular session on the exchange's clock, `HHMM-HHMM` (several, comma separated: the last one closes the day) or `24x7` */
  hours: string | null;
  timezone: string | null;
}

/**
 * The clock time the regular session ends: `0930-1600` → 16:00. TradingView's strings carry more:
 * several sessions a day (`,` or `S` between them, the last one closes the day), an auction window
 * after `E`, weekdays after `:` and other days' hours after `|`.
 */
export function sessionEnd(hours: string): { hh: number; mm: number } | null {
  const m = /^\d{4}F?-(\d{2})(\d{2})/.exec(hours.split("|")[0].split(/[,S]/).at(-1)!.trim());
  return m ? { hh: Number(m[1]), mm: Number(m[2]) } : null;
}

/** The start of the next UTC day, week (Monday), month or quarter after `now`. */
function nextUtcBucket(now: number, tf: Timeframe): number {
  const d = new Date(now);
  const [y, m, day] = [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()];
  if (tf === "D") return Date.UTC(y, m, day + 1);
  if (tf === "W") return Date.UTC(y, m, day + 7 - ((d.getUTCDay() + 6) % 7));
  return tf === "M" ? Date.UTC(y, m + 1, 1) : Date.UTC(y, Math.floor(m / 3) * 3 + 3, 1);
}

const weekday = (p: Parts) => new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();

/** The last weekday of the week, month or quarter a trading day is in; the day itself when that is already past (a weekend session). */
function lastTradingDay(day: Parts, tf: Timeframe): Parts {
  if (tf === "D") return day;
  const dow = weekday(day);
  if (tf === "W") return dow >= 1 && dow <= 5 ? dayOf(day, 5 - dow) : day;
  const endMonth = tf === "M" ? day.m : Math.floor((day.m - 1) / 3) * 3 + 3;
  // day 0 of the next month is the last day of this one
  let last = dayOf({ ...day, m: endMonth + 1, d: 0 });
  while (weekday(last) === 0 || weekday(last) === 6) last = dayOf(last, -1);
  return Date.UTC(last.y, last.m - 1, last.d) >= Date.UTC(day.y, day.m - 1, day.d) ? last : day;
}

/**
 * When the bar of `tf` that is forming now closes (ms), or null when there is nothing to count
 * down to: no current quote, the market is not in its regular session, or its hours are unknown.
 * Around the clock (crypto) bars end with the UTC day, week, month or quarter. An exchange's daily
 * bar ends at the next close of its regular session after the quote; a weekly, monthly or
 * quarterly one at that close on the period's last weekday (holidays are not known here).
 */
export function barCloseAt(tf: Timeframe, now: number, { session, quotedAt, hours, timezone }: SessionClock): number | null {
  if (session === "always" || (session === "open" && hours === "24x7")) return nextUtcBucket(now, tf);
  if (session !== "open" || quotedAt === null || !hours || !timezone) return null;
  const end = sessionEnd(hours);
  if (!end) return null;
  // the session is the quote's: counted from when it was taken, so a close that has passed since ends the countdown
  let day = dayOf(partsIn(new Date(quotedAt), timezone));
  if (zonedToUtc({ ...day, ...end }, timezone) <= quotedAt) day = dayOf(day, 1);
  const close = zonedToUtc({ ...lastTradingDay(day, tf), ...end }, timezone);
  return close > now ? close : null;
}

/** TradingView's countdown: `2d 5h` from a day up, `05:12:09` from an hour up, else `12:09`. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  const rest = `${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return s >= 3600 ? `${two(Math.floor(s / 3600))}:${rest}` : rest;
}
