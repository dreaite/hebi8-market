/** Wall-clock helpers on top of Intl, enough for scheduling and ISO weeks without a date library. */

export interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let fmt = formatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    formatters.set(tz, fmt);
  }
  return fmt;
}

/** Wall-clock parts of an instant in a timezone. */
export function partsIn(date: Date, tz: string): Parts {
  const get = (type: string) => Number(formatter(tz).formatToParts(date).find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour") % 24, mm: get("minute") };
}

/** The instant (ms) at which a wall-clock time happens in a timezone; handles DST shifts. */
export function zonedToUtc(p: Parts, tz: string): number {
  const wanted = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const got = partsIn(new Date(guess), tz);
    guess += wanted - Date.UTC(got.y, got.m - 1, got.d, got.hh, got.mm);
  }
  return guess;
}

/** UTC-midnight date for a wall-clock day, for calendar math. */
export function dayOf(p: Parts, offsetDays = 0): Parts {
  const d = new Date(Date.UTC(p.y, p.m - 1, p.d + offsetDays));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: 0, mm: 0 };
}
