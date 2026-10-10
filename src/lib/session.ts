/**
 * When the unfinished bar of a timeframe closes, for the countdown under the last price (design
 * §5.2), TradingView's way. Pure, shared by the server's tests and the chart.
 */
import type { QuoteSession } from "./sources/types";
import type { Timeframe } from "./symbols";
import { dayOf, partsIn, zonedToUtc, type Parts } from "./tz";

/** The quote poller's round (src/lib/quotes.ts); pre-market, after-hours and closed markets are asked hourly. */
export const QUOTE_ROUND_MS = 5 * 60 * 1000;
export const QUOTE_SLOW_MS = 60 * 60 * 1000;

/** Whether polling still keeps a quote current: three rounds for open markets and crypto, an hour and two rounds otherwise. */
export function quoteIsCurrent(session: QuoteSession, fetchedAt: number, now: number): boolean {
  return now - fetchedAt < (session === "open" || session === "always" ? 3 * QUOTE_ROUND_MS : QUOTE_SLOW_MS + 2 * QUOTE_ROUND_MS);
}

export interface SessionClock {
  /** The last quote's session while it is current, and when that quote was taken (ms) */
  session: QuoteSession | null;
  quotedAt: number | null;
  /** The regular session on the exchange's clock, `HHMM-HHMM` or `24x7`, in TradingView's notation (see `sessionEnd`) */
  hours: string | null;
  timezone: string | null;
}

/**
 * The clock time the regular session ends on a weekday (0 = Sunday): `0930-1600` → 16:00.
 * TradingView's strings carry more: several sessions a day (`,` or `S` between them, the last one
 * closes the day), an auction window after `E`, and other hours for some days after `|`, each
 * with its days after `:` (1 = Sunday; Monday to Friday when left out). Hours given for the day
 * by name win over the ones that only cover it by default.
 */
export function sessionEnd(hours: string, weekday: number): { hh: number; mm: number } | null {
  const day = String(weekday + 1);
  const parts = hours.split("|").map((part) => ({ part, days: /:(\d+)$/.exec(part.trim())?.[1] }));
  const { part } = parts.find((p) => p.days?.includes(day)) ?? parts.find((p) => !p.days && weekday >= 1 && weekday <= 5) ?? parts[0];
  const m = /^\d{4}F?-(\d{2})(\d{2})/.exec(part.split(/[,S]/).at(-1)!.trim());
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
 * down to: no quote that is still current, the market is not in its regular session, or its hours
 * are unknown. Around the clock (crypto) bars end with the UTC day, week, month or quarter. An
 * exchange's daily bar ends at the next close of its regular session after the quote; a weekly,
 * monthly or quarterly one at the close of the period's last weekday (holidays are not known here).
 */
export function barCloseAt(tf: Timeframe, now: number, { session, quotedAt, hours, timezone }: SessionClock): number | null {
  // judged here too, not only by the server: a page that cannot reach it stops counting on its own
  if (session === null || quotedAt === null || !quoteIsCurrent(session, quotedAt, now)) return null;
  if (session === "always" || (session === "open" && hours === "24x7")) return nextUtcBucket(now, tf);
  if (session !== "open" || !hours || !timezone) return null;
  const endOn = (day: Parts) => sessionEnd(hours, weekday(day));
  // the session is the quote's: counted from when it was taken, so a close that has passed since ends the countdown
  let day = dayOf(partsIn(new Date(quotedAt), timezone));
  const today = endOn(day);
  if (!today) return null;
  if (zonedToUtc({ ...day, ...today }, timezone) <= quotedAt) day = dayOf(day, 1);
  const last = lastTradingDay(day, tf);
  const close = zonedToUtc({ ...last, ...endOn(last)! }, timezone);
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
