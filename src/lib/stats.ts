import { aggregate, closeAtOrBefore, type Bar } from "./series";
import { DAY } from "./time";

export interface OverviewStats {
  last: number;
  lastTime: number;
  chg1w: number | null;
  chg1m: number | null;
  chg1y: number | null;
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
  const first = daily[0];
  const { c: last, t } = lastBar;

  let ath = -Infinity;
  for (const bar of daily) ath = Math.max(ath, bar.c);

  let hi = -Infinity;
  let lo = Infinity;
  for (let i = daily.length - 1; i >= 0 && daily[i].t > t - 365 * DAY; i--) {
    hi = Math.max(hi, daily[i].h);
    lo = Math.min(lo, daily[i].l);
  }
  const hasYear = first.t <= t - 365 * DAY;

  return {
    last,
    lastTime: t,
    chg1w: change(last, closeAtOrBefore(daily, t - 7 * DAY)),
    chg1m: change(last, closeAtOrBefore(daily, t - 30 * DAY)),
    chg1y: hasYear ? change(last, closeAtOrBefore(daily, t - 365 * DAY)) : null,
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
