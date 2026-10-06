/**
 * What the current page is showing, for in-app feedback. The chart page writes its state here
 * (symbol, timeframe, style, indicators, compares) and clears it when it unmounts.
 */
import type { ChartContext } from "./feedback";

let chart: ChartContext | null = null;

export function setChartContext(next: ChartContext | null): void {
  chart = next;
}

export function getChartContext(): ChartContext | null {
  return chart;
}
