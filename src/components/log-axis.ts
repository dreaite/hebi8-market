import type { AxisTick, Chart, YAxisTemplate } from "klinecharts";

/** KLineChart's own log: 0 stays 0 and a negative value is mirrored. */
function log(value: number): number {
  if (value === 0) return 0;
  return value < 0 ? -Math.log10(-value) : Math.log10(value);
}

/** As many ticks as KLineChart aims for on a linear axis. */
const TICK_COUNT = 8;
/** KChart.tsx's y-axis tick text size; like the library's ticks, labels keep two lines apart and off the edges. */
const TEXT_HEIGHT = 11;

/** The m × 10^n nearest to `x` (by ratio) for m in `mantissas`. */
function niceStep(x: number, mantissas: number[]): number {
  const exp = Math.floor(Math.log10(x));
  let best = 0;
  let bestDist = Infinity;
  for (const e of [exp, exp + 1]) {
    for (const m of mantissas) {
      const step = m * 10 ** e;
      const dist = Math.abs(Math.log(step / x));
      if (dist < bestDist) {
        bestDist = dist;
        best = step;
      }
    }
  }
  return best;
}

/** Library-default formatting: thousands separated by commas, 3+ leading zeros folded into 0.0{n}. */
function tickText(value: number, precision: number): string {
  const [int, frac] = value.toFixed(precision).split(".");
  const text = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (frac === undefined) return text;
  const zeros = /^0*/.exec(frac)![0].length;
  return zeros >= 3 && zeros < frac.length ? `${text}.0{${zeros}}${frac.slice(zeros)}` : `${text}.${frac}`;
}

/**
 * TradingView's log-scale ticks between two log10 prices: evenly spaced on screen, each one a
 * round number. Spanning decades per tick, only powers of ten; around a third of a decade, the
 * 1, 2 and 5 of each decade; closer, steps of 1, 2, 2.5 or 5 × 10^n sized to the price where they
 * are, so a narrow range gets the even steps of a linear axis. Labels use the symbol's price
 * precision; a tick that precision cannot show exactly (602.5 at 0 decimals) is dropped.
 */
export function logTicks(realFrom: number, realTo: number, height: number, precision: number): AxisTick[] {
  const stride = (realTo - realFrom) / TICK_COUNT;
  const values: number[] = [];
  if (stride >= 0.65) {
    const k = Math.max(1, Math.round(stride));
    for (let e = Math.ceil(realFrom / k) * k; e <= realTo; e += k) values.push(10 ** e);
  } else if (stride >= Math.log10(2)) {
    for (let e = Math.floor(realFrom); e <= realTo; e++) {
      for (const m of [1, 2, 5]) {
        const value = m * 10 ** e;
        if (Math.log10(value) >= realFrom && Math.log10(value) <= realTo) values.push(value);
      }
    }
  } else {
    // the price distance one stride covers at `value`; the step grows along 1, 2, 5 as that does
    // (a 2.5 there would only last a tick or two)
    const span = (value: number) => value * (10 ** stride - 1);
    const from = 10 ** realFrom;
    const to = 10 ** realTo;
    let step = niceStep(span(from), [1, 2, 2.5, 5]);
    let value = Math.ceil(from / step - 1e-9) * step;
    while (value <= to) {
      values.push(value);
      const bigger = niceStep(span(value), [1, 2, 5]);
      if (bigger <= step) {
        value = (Math.floor(value / step + 1e-9) + 1) * step;
        continue;
      }
      // on a bigger step, the multiple of it nearest (by ratio) to one stride up: 4000 then 10,000, not 5000
      step = bigger;
      const target = value * 10 ** stride;
      const below = Math.max(Math.floor(value / step + 1e-9) + 1, Math.floor(target / step)) * step;
      value = target / below <= (below + step) / target ? below : below + step;
    }
  }
  const ticks: AxisTick[] = [];
  let last = -Infinity;
  for (const value of values) {
    const coord = Math.round((1 - (Math.log10(value) - realFrom) / (realTo - realFrom)) * height);
    if (coord <= TEXT_HEIGHT || coord >= height - TEXT_HEIGHT || Math.abs(coord - last) < TEXT_HEIGHT * 2) continue;
    // a tick the precision cannot show as is would be labelled with a neighbour's price, or a twin's
    if (Math.abs(+value.toFixed(precision) - value) > value * 1e-9) continue;
    ticks.push({ coord, value, text: tickText(value, precision) });
    last = coord;
  }
  return ticks;
}

/**
 * KLineChart's logarithm axis with the way back out of log space fixed. The library undoes its
 * mirroring of negative values on the log value, `v < 0 ? -10^|v| : 10^v`, but every price below
 * 1 has a negative log, so 0.65 (log −0.19) came back as −1.53: on the ticks, the price labels, the
 * crosshair and the range everything else reads. Prices on a log scale are positive, so it is 10^v.
 * The library's ticks are a linear axis' laid out on the log scale, crowded at the bottom and
 * sparse at the top; `logTicks` picks them the way TradingView does.
 * Registered under the library's name, it replaces the built-in axis.
 */
export const LOG_AXIS: YAxisTemplate = {
  name: "logarithm",
  minSpan: (precision) => 0.05 * 10 ** -precision,
  valueToRealValue: log,
  displayValueToRealValue: log,
  realValueToValue: (value) => 10 ** value,
  realValueToDisplayValue: (value) => 10 ** value,
  createRange: ({ defaultRange: r }) => {
    const realFrom = log(r.from);
    const realTo = log(r.to);
    return { ...r, realFrom, realTo, realRange: realTo - realFrom };
  },
  // called on the axis itself; the precision is the one the library's own ticks and price labels use
  createTicks(this: { getParent: () => { getChart: () => Chart } }, { range, bounding }) {
    const precision = this.getParent().getChart().getSymbol()?.pricePrecision ?? 2;
    return logTicks(range.realFrom, range.realTo, bounding.height, precision);
  },
};
