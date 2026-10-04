import { CHANGE_PERIODS, type ChangePeriod } from "./periods";
import { aggregate, closeAtOrBefore, type Bar } from "./series";
import { DAY } from "./time";

export interface OverviewStats {
  last: number;
  lastTime: number;
  /** Change versus the close at the start of each period; null when history is too short */
  changes: Record<ChangePeriod, number | null>;
  /** Distance from the all-time high close, <= 0 */
  ddAth: number;
  /** Position of the last close inside the trailing 52-week low/high range, 0..1 */
  pos52: number | null;
  /** Weekly closes for the last two years */
  spark: number[];
}

function change(last: number, prev: number | undefined): number | null {
  return prev ? last / prev - 1 : null;
}

export function overviewStats(daily: Bar[]): OverviewStats | null {
  const lastBar = daily.at(-1);
  if (!lastBar) return null;
  const { c: last, t } = lastBar;
  const yearStart = Date.UTC(new Date(t * 1000).getUTCFullYear(), 0, 1) / 1000;

  let ath = -Infinity;
  for (const bar of daily) ath = Math.max(ath, bar.c);

  let hi = -Infinity;
  let lo = Infinity;
  for (let i = daily.length - 1; i >= 0 && daily[i].t > t - 365 * DAY; i--) {
    hi = Math.max(hi, daily[i].h);
    lo = Math.min(lo, daily[i].l);
  }

  // closeAtOrBefore is undefined before the first bar, so short histories yield null
  const changes = Object.fromEntries(
    CHANGE_PERIODS.map(({ key, days }) => [
      key,
      change(last, closeAtOrBefore(daily, days === null ? yearStart - 1 : t - days * DAY)),
    ]),
  ) as Record<ChangePeriod, number | null>;

  return {
    last,
    lastTime: t,
    changes,
    ddAth: last / ath - 1,
    pos52: hi > lo ? (last - lo) / (hi - lo) : null,
    spark: aggregate(daily.slice(-800), "W").slice(-104).map((bar) => bar.c),
  };
}

/** Decimal places that keep ~5 significant digits for typical prices. */
export function pricePrecision(price: number): number {
  const abs = Math.abs(price);
  if (abs >= 10) return 2;
  if (abs >= 1) return 3;
  if (abs >= 0.01) return 5;
  return 8;
}
