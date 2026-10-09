/**
 * A drawing as saved (`OverlaySpec`) and back. KLineChart keeps the point objects it is given and
 * merges new styles into the ones it has, so neither way shares an object with the chart: a saved
 * state (the undo history among them) never changes under a later drag or style. Type-only imports,
 * so it loads without KLineChart.
 */
import type { Overlay, OverlayCreate } from "klinecharts";
import type { OverlaySpec } from "@/lib/vault";
import type { PriceScale } from "./drawing-scale";

/**
 * Per-drawing lock and hide ("lock all" and "hide all" are UI modes applied on top), the
 * TradingView drawing an imported one came from, and the price scale it was drawn on: kept beside
 * KLineChart, which has no field for them.
 */
export type DrawingFlags = { lock?: boolean; hidden?: boolean; tvId?: string; scale?: PriceScale };

/** A finished drawing as saved; null for one without points. */
export function specOf(o: Pick<Overlay, "id" | "name" | "points" | "styles" | "extendData">, flags: Map<string, DrawingFlags>): OverlaySpec | null {
  const points = o.points
    .filter((p) => typeof p.timestamp === "number" && typeof p.value === "number")
    .map((p) => ({ timestamp: p.timestamp!, value: p.value! }));
  if (points.length === 0) return null;
  const spec: OverlaySpec = { name: o.name, points };
  if (o.styles) spec.styles = structuredClone(o.styles);
  // "lock all" and "hide all" are UI modes, not properties of each drawing
  const f = flags.get(o.id);
  if (f?.lock) spec.lock = true;
  if (f?.hidden) spec.hidden = true;
  if (o.extendData !== undefined && o.extendData !== null && typeof o.extendData !== "function") spec.extendData = structuredClone(o.extendData);
  if (f?.tvId) spec.tvId = f.tvId;
  if (f?.scale) spec.scale = f.scale;
  return spec;
}

/** What KLineChart is given to draw a saved drawing: copies, never the spec's own objects. */
export function drawingOf(spec: OverlaySpec): OverlayCreate {
  return {
    name: spec.name,
    points: spec.points.map((p) => ({ ...p })),
    extendData: structuredClone(spec.extendData),
    ...(spec.styles ? { styles: structuredClone(spec.styles) as OverlayCreate["styles"] } : {}),
  };
}
