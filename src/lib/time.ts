const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timeZone);
  if (!fmt) {
    try {
      fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    } catch {
      fmt = formatterFor("UTC");
    }
    formatters.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Map a daily bar timestamp (unix seconds) to its trading day, as unix seconds at UTC midnight.
 *
 * Sources stamp daily bars differently: US stocks at the open (13:30 UTC), Asian exchanges at
 * 01:30 UTC, FX and TVC futures at the session start on the previous evening (22:00 UTC Sunday
 * for Monday). Shifting by 12h inside the exchange timezone lands every case on the right date.
 */
export function tradingDay(tsSec: number, timeZone = "UTC"): number {
  const [y, m, d] = formatterFor(timeZone)
    .format(new Date((tsSec + 12 * 3600) * 1000))
    .split("-")
    .map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

export const DAY = 86400;
