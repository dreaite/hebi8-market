import type { IndicatorTemplate } from "klinecharts";
import { calcDrawdown, calcRelativeStrength } from "./calc";

/**
 * Custom indicators, registered on top of KLineChart's built-ins.
 * Adding one = write a template here, then list it in ./catalog.ts.
 */

export const drawdown: IndicatorTemplate<{ dd: number }, number> = {
  name: "DD",
  shortName: "回撤",
  precision: 2,
  calcParams: [],
  maxValue: 0,
  figures: [{ key: "dd", title: "距高点 %: ", type: "line" }],
  calc: (dataList) => calcDrawdown(dataList.map((d) => d.close)).map((dd) => ({ dd })),
};

/** Needs `bench` (benchmark close) on each bar; the /api/bars response provides it. */
export const relativeStrength: IndicatorTemplate<{ rs?: number; rsma?: number }, number> = {
  name: "RS",
  shortName: "相对强弱",
  precision: 2,
  calcParams: [26],
  figures: [
    { key: "rs", title: "RS: ", type: "line" },
    { key: "rsma", title: "MA: ", type: "line" },
  ],
  calc: (dataList, indicator) =>
    calcRelativeStrength(
      dataList.map((d) => d.close),
      dataList.map((d) => (typeof d.bench === "number" ? d.bench : undefined)),
      indicator.calcParams[0] ?? 26,
    ),
};

export const customIndicators = [drawdown, relativeStrength];
