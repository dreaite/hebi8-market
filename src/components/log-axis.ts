import type { YAxisTemplate } from "klinecharts";

/** KLineChart's own log: 0 stays 0 and a negative value is mirrored. */
function log(value: number): number {
  if (value === 0) return 0;
  return value < 0 ? -Math.log10(-value) : Math.log10(value);
}

/**
 * KLineChart's logarithm axis with the way back out of log space fixed. The library undoes its
 * mirroring of negative values on the log value, `v < 0 ? -10^|v| : 10^v`, but every price below
 * 1 has a negative log, so 0.65 (log −0.19) came back as −1.53: on the ticks, the price labels, the
 * crosshair and the range everything else reads. Prices on a log scale are positive, so it is 10^v.
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
};
