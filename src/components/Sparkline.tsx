interface SparklineProps {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
}

/** Tiny SVG line; color follows the overall direction of the series. */
export function Sparkline({ values, className = "", width = 240, height = 48 }: SparklineProps) {
  if (values.length < 2) return <div style={{ height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const rising = values[values.length - 1] >= values[0];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={`w-full ${rising ? "text-up" : "text-down"} ${className}`}
      style={{ height }}
      aria-hidden
    >
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
