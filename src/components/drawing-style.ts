/**
 * The style model of a drawing: one colour, width and dash in `styles.line`, from which every
 * figure of the drawing (lines, outlines, fills, labels) takes its look. Type-only imports, so
 * it loads without KLineChart (which needs a window).
 */
import type { Chart, DeepPartial, LineStyle, Overlay, OverlayStyle } from "klinecharts";

export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${alpha})`;
}

export type LineDash = "solid" | "dashed" | "dotted";
export const DASHES: Record<Exclude<LineDash, "solid">, number[]> = { dashed: [6, 4], dotted: [1.5, 3] };

/** The KLineChart styles of a drawing with this colour, width and dash: lines, outlines, fills and labels alike. */
export function drawingStyles(color: string, size: number, dash: LineDash): DeepPartial<OverlayStyle> {
  const style = dash === "solid" ? "solid" : "dashed";
  const dashedValue = dash === "solid" ? DASHES.dashed : DASHES[dash];
  const shape = { color: withAlpha(color, 0.12), borderColor: color, borderSize: size, borderStyle: style, borderDashedValue: dashedValue } as const;
  return {
    line: { color, size, style, dashedValue },
    polygon: { ...shape, style: "stroke_fill" },
    rect: { ...shape, style: "stroke_fill" },
    circle: { ...shape, style: "stroke_fill" },
    arc: { color, size, style, dashedValue },
    text: { backgroundColor: color, borderColor: color },
    point: { color, borderColor: withAlpha(color, 0.35), activeColor: color, activeBorderColor: withAlpha(color, 0.35) },
  };
}

/** The colour, width and dash a drawing is drawn with. */
export function lineOf(chart: Chart, overlay: Pick<Overlay, "styles">): LineStyle {
  return { ...chart.getStyles().overlay.line, ...(overlay.styles?.line as Partial<LineStyle> | undefined) };
}

export function dashOf(line: Pick<LineStyle, "style" | "dashedValue">): LineDash {
  if (line.style !== "dashed") return "solid";
  return line.dashedValue?.[0] !== undefined && line.dashedValue[0] < 3 ? "dotted" : "dashed";
}
