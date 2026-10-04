import type { IndicatorTemplate } from "klinecharts";
import { compile, evaluate } from "./formula";

/** A user-defined indicator, stored in the browser. */
export interface FormulaDef {
  id: string;
  label: string;
  source: string;
  pane: "main" | "sub";
}

const PREFIX = "F_";
export const formulaIndicatorName = (id: string) => `${PREFIX}${id}`;
export const isFormulaIndicator = (name: string) => name.startsWith(PREFIX);

export function newFormulaId(): string {
  return Math.random().toString(36).slice(2, 10);
}

type Point = Record<string, number | undefined>;

/** KLineChart template for a formula, or null if it no longer compiles. */
export function formulaTemplate(def: FormulaDef): IndicatorTemplate<Point> | null {
  let program;
  try {
    program = compile(def.source);
  } catch {
    return null;
  }
  return {
    name: formulaIndicatorName(def.id),
    shortName: def.label,
    // overlays share the price axis and its precision; sub-pane values are usually ratios
    series: def.pane === "main" ? "price" : "normal",
    precision: 2,
    calcParams: [],
    figures: program.outputs.map((title, i) => ({ key: `v${i}`, title: `${title}: `, type: "line" })),
    calc: (dataList) => {
      const lines = evaluate(program, dataList);
      return dataList.map((_, i) => {
        const point: Point = {};
        lines.forEach((line, j) => {
          point[`v${j}`] = Number.isFinite(line[i]) ? line[i] : undefined;
        });
        return point;
      });
    },
  };
}

export const FORMULA_EXAMPLES: Omit<FormulaDef, "id">[] = [
  { label: "均线乖离", source: "(close / sma(close, 40) - 1) * 100", pane: "sub" },
  { label: "双 EMA", source: "fast = ema(close, 10)\nslow = ema(close, 40)", pane: "main" },
  { label: "相对基准", source: "close / bench", pane: "sub" },
  { label: "唐奇安通道", source: "upper = highest(high, 20)\nlower = lowest(low, 20)", pane: "main" },
];
