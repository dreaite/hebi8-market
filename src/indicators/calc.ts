/** Simple moving average; undefined until the window is full of defined values. */
export function sma(values: (number | undefined)[], period: number): (number | undefined)[] {
  const out: (number | undefined)[] = [];
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === undefined) {
      sum = 0;
      count = 0;
      out.push(undefined);
      continue;
    }
    sum += v;
    count++;
    if (count > period) {
      sum -= values[i - period]!;
      count = period;
    }
    out.push(count === period ? sum / period : undefined);
  }
  return out;
}

/** Percent below the running peak close: 0 at a new high, -50 after halving. */
export function calcDrawdown(closes: number[]): number[] {
  let peak = -Infinity;
  return closes.map((c) => {
    peak = Math.max(peak, c);
    return (c / peak - 1) * 100;
  });
}

/**
 * Price relative to a benchmark, rebased to 100 at the first bar with benchmark data,
 * plus its moving average. A rising line means outperforming the benchmark.
 */
export function calcRelativeStrength(
  closes: number[],
  benchmark: (number | undefined)[],
  maPeriod: number,
): { rs?: number; rsma?: number }[] {
  let base: number | undefined;
  const rs = closes.map((c, i) => {
    const b = benchmark[i];
    if (!b) return undefined;
    const ratio = c / b;
    base ??= ratio;
    return (ratio / base) * 100;
  });
  const ma = sma(rs, Math.max(1, Math.round(maPeriod)));
  return rs.map((v, i) => ({ rs: v, rsma: ma[i] }));
}
