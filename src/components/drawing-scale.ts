/**
 * Price scales for drawings: a log axis is straight in log prices, so moving a drawing on it is a
 * ratio, not a difference. Pure math, tested without a chart.
 */
export type PriceScale = "log" | "linear";

/**
 * The prices of a whole drawing dragged by the pointer from price `from` to `to`: shifted by the
 * difference in a linear space, scaled by the ratio in a log one, so its shape holds. Null when a
 * price would land at zero or below where that cannot be drawn (`positive`: the drawing or the axis
 * is logarithmic); the drawing then stays where it was.
 */
export function movePrices(values: (number | undefined)[], from: number, to: number, scale: PriceScale, positive: boolean): (number | undefined)[] | null {
  const moved = values.map((v) => (v === undefined ? v : scale === "log" ? v * (to / from) : v + (to - from)));
  return moved.every((v) => v === undefined || (Number.isFinite(v) && (!positive || v > 0))) ? moved : null;
}
