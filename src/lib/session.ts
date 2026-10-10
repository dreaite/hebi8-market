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

/**
 * When an instrument trades, as its source describes it (TradingView's notation, kept as it comes):
 * the regular session on the exchange's clock, the days without trading and the days with other
 * hours. Everything may be missing; what is known is used.
 */
export interface TradingCalendar {
  /**
   * `0930-1600`, `24x7`, or more: several sessions a day (`,`, `S` or `U` between them, the last
   * one closes the day), auction windows after `A` and `E`, other hours for some days after `|`,
   * each with its days after `:` (1 = Sunday; Monday to Friday when left out), and earlier
   * versions of all that before `#YYYYMMDD/` (the hours until that day).
   */
  hours: string | null;
  timezone: string | null;
  /** Days without trading: `20261126,20261225` */
  holidays: string | null;
  /** Days with other hours, which win over the holidays: `0930-1300:20261127,20261224;dayoff:20250109` */
  corrections: string | null;
}

export interface SessionClock extends TradingCalendar {
  /** The last quote's session while it is current, and when that quote was taken (ms) */
  session: QuoteSession | null;
  quotedAt: number | null;
}

const weekday = (p: Parts) => new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
const ymd = (p: Parts) => `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`;
const sameOrAfter = (a: Parts, b: Parts) => ymd(a) >= ymd(b);

/**
 * The sessions of one day (`0930-1600`, `0930-1130,1300-1500`), or null when there is no trading:
 * a correction for that date first (`dayoff` shuts it), then the holidays, then the regular hours
 * for its weekday, where hours that name the day win over the ones that cover it by default.
 */
export function sessionsOn({ hours, holidays, corrections }: TradingCalendar, day: Parts): string | null {
  const date = ymd(day);
  for (const entry of corrections ? corrections.split(";") : []) {
    const at = entry.lastIndexOf(":");
    if (entry.slice(at + 1).split(",").includes(date)) return entry.startsWith("dayoff") ? null : entry.slice(0, at);
  }
  if (!hours || holidays?.split(",").includes(date)) return null;
  // `A#20260803/B`: A until that day, B from it on
  const versions = hours.split("/");
  const version = versions.find((v) => (/#(\d{8})$/.exec(v)?.[1] ?? "99999999") > date) ?? versions[versions.length - 1];
  const dow = weekday(day);
  const parts = version.replace(/#\d{8}$/, "").split("|").map((part) => ({ part: part.replace(/:\d+$/, ""), days: /:(\d+)$/.exec(part)?.[1] }));
  return (parts.find((p) => p.days?.includes(String(dow + 1))) ?? parts.find((p) => !p.days && dow >= 1 && dow <= 5))?.part ?? null;
}

/** The clock time a day's last session ends, or null when the day has no trading (or hours that do not parse). */
export function closeOn(calendar: TradingCalendar, day: Parts): { hh: number; mm: number } | null {
  const m = /^\d{4}(?:F\d*)?-(\d{2})(\d{2})/.exec(sessionsOn(calendar, day)?.split(/[,SU]/).at(-1) ?? "");
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

/** The last day with trading in the week (Monday to Sunday), month or quarter a trading day is in: holidays and weekends at the end are stepped over. */
function lastTradingDay(calendar: TradingCalendar, day: Parts, tf: Timeframe): Parts {
  if (tf === "D") return day;
  const endMonth = tf === "M" ? day.m : Math.floor((day.m - 1) / 3) * 3 + 3;
  // day 0 of the next month is the last day of this one
  let last = tf === "W" ? dayOf(day, (7 - weekday(day)) % 7) : dayOf({ ...day, m: endMonth + 1, d: 0 });
  while (!sameOrAfter(day, last) && !closeOn(calendar, last)) last = dayOf(last, -1);
  return last;
}

/** How far ahead the next trading day is looked for: longer than any run of holidays. */
const LOOKAHEAD_DAYS = 14;

/**
 * When the bar of `tf` that is forming now closes (ms), or null when there is nothing to count
 * down to: no quote that is still current, the market is not in its regular session, or its hours
 * are unknown. Around the clock (crypto) bars end with the UTC day, week, month or quarter. An
 * exchange's daily bar ends at the first close after the quote, at the earlier time on a half
 * day; a weekly, monthly or quarterly one at the close of the period's last day with trading.
 * Without holidays and corrections every weekday counts as a full trading day.
 */
export function barCloseAt(tf: Timeframe, now: number, clock: SessionClock): number | null {
  const { session, quotedAt, hours, timezone } = clock;
  // judged here too, not only by the server: a page that cannot reach it stops counting on its own
  if (session === null || quotedAt === null || !quoteIsCurrent(session, quotedAt, now)) return null;
  if (session === "always" || (session === "open" && hours === "24x7")) return nextUtcBucket(now, tf);
  if (session !== "open" || !hours || !timezone) return null;
  const closeAt = (day: Parts) => {
    const end = closeOn(clock, day);
    return end ? zonedToUtc({ ...day, ...end }, timezone) : null;
  };
  // the session is the quote's: counted from when it was taken, so a close that has passed since ends the countdown
  let day = dayOf(partsIn(new Date(quotedAt), timezone));
  for (let i = 0; (closeAt(day) ?? 0) <= quotedAt; i++, day = dayOf(day, 1)) if (i === LOOKAHEAD_DAYS) return null;
  const close = closeAt(lastTradingDay(clock, day, tf))!;
  return close > now ? close : null;
}

/**
 * When the daily bar of trading day `t` (unix seconds at UTC midnight) is complete (ms): the end
 * of the UTC day around the clock, the close of that day's session at an exchange (the earlier one
 * on a half day), and the end of the day on the exchange's calendar while its hours are not known.
 * A bar on a day the calendar calls a holiday did trade: its regular hours count.
 */
export function dayCloseAt(t: number, calendar: TradingCalendar): number {
  if (calendar.hours === "24x7") return (t + 86400) * 1000;
  const day = dayOf(partsIn(new Date(t * 1000), "UTC"));
  const end = closeOn(calendar, day) ?? closeOn({ ...calendar, holidays: null, corrections: null }, day);
  return zonedToUtc(end ? { ...day, ...end } : dayOf(day, 1), calendar.timezone ?? "UTC");
}

/**
 * The session to assume when a source's quote does not say: open on a day with trading, closed on
 * a weekend or a holiday, by the exchange's own date. Without known hours weekdays count as trading.
 */
export function scheduledSession(now: number, calendar: TradingCalendar): QuoteSession {
  const day = dayOf(partsIn(new Date(now), calendar.timezone ?? "UTC"));
  const trading = calendar.hours ? sessionsOn(calendar, day) !== null : weekday(day) >= 1 && weekday(day) <= 5;
  return trading ? "open" : "closed";
}

/** TradingView's countdown: `2d 5h` from a day up, `05:12:09` from an hour up, else `12:09`. */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  const rest = `${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return s >= 3600 ? `${two(Math.floor(s / 3600))}:${rest}` : rest;
}
