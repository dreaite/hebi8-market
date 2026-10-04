import { describe, expect, it } from "vitest";
import { compile, evaluate, FormulaError, type OhlcvBar } from "@/indicators/formula";
import { formulaTemplate } from "@/indicators/formula-indicators";

const bars = (closes: number[], extra: Partial<OhlcvBar>[] = []): OhlcvBar[] =>
  closes.map((close, i) => ({ open: close, high: close + 1, low: close - 1, close, volume: 10, ...extra[i] }));

const run = (source: string, data: OhlcvBar[]) => evaluate(compile(source), data);
const round = (s: number[]) => s.map((v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v));

describe("compile", () => {
  it("names lines from assignments, or numbers them", () => {
    expect(compile("fast = ema(close, 10); slow = ema(close, 40)").outputs).toEqual(["fast", "slow"]);
    expect(compile("close\nopen").outputs).toEqual(["L1", "L2"]);
    expect(compile("close * 2").outputs).toEqual(["值"]);
  });

  it("ignores comments and blank lines", () => {
    expect(compile("# drawdown\n\n(close / cummax(close) - 1) * 100 # percent\n").outputs).toHaveLength(1);
  });

  it.each([
    ["", "公式为空"],
    ["clsoe", "未知变量「clsoe」"],
    ["foo(close)", "未知函数「foo」"],
    ["sma(close)", "参数个数不对"],
    ["(close + 1", "缺少「)」"],
    ["close close", "多了内容"],
    ["close +", "公式不完整"],
    ["close $ 2", "无法识别的字符"],
    ["b = a + 1; a = close", "未知变量「a」"],
  ])("rejects %j", (source, message) => {
    expect(() => compile(source)).toThrow(FormulaError);
    expect(() => compile(source)).toThrow(message);
  });

  it("reports the position of the problem", () => {
    const error = (() => {
      try {
        compile("close + clsoe");
      } catch (err) {
        return err as FormulaError;
      }
    })();
    expect(error?.pos).toBe(8);
  });
});

describe("evaluate", () => {
  const data = bars([1, 2, 3, 4, 5]);

  it("follows operator precedence and broadcasts scalars", () => {
    expect(run("1 + 2 * 3 ^ 2", data)[0]).toEqual([19, 19, 19, 19, 19]);
    expect(run("-close + 10", data)[0]).toEqual([9, 8, 7, 6, 5]);
    expect(run("2 ^ 3 ^ 2", data)[0][0]).toBe(512); // right-associative
  });

  it("provides price-derived series", () => {
    expect(run("hl2", data)[0]).toEqual([1, 2, 3, 4, 5]);
    expect(run("volume", data)[0]).toEqual([10, 10, 10, 10, 10]);
  });

  it("lets later statements reuse named lines", () => {
    const [a, b] = run("a = close * 2; a + 1", data);
    expect(a).toEqual([2, 4, 6, 8, 10]);
    expect(b).toEqual([3, 5, 7, 9, 11]);
  });

  it("computes rolling windows with a warm-up", () => {
    expect(run("sma(close, 2)", data)[0]).toEqual([NaN, 1.5, 2.5, 3.5, 4.5]);
    expect(run("highest(close, 3)", data)[0]).toEqual([NaN, NaN, 3, 4, 5]);
    expect(run("lowest(low, 2)", data)[0]).toEqual([NaN, 0, 1, 2, 3]);
    expect(run("sum(close, 5)", data)[0]).toEqual([NaN, NaN, NaN, NaN, 15]);
    expect(round(run("std(close, 2)", data)[0])).toEqual([NaN, 0.5, 0.5, 0.5, 0.5]);
  });

  it("seeds ema with the simple average", () => {
    expect(run("ema(close, 3)", data)[0]).toEqual([NaN, NaN, 2, 3, 4]);
  });

  it("shifts and compares against earlier bars", () => {
    expect(run("ref(close, 2)", data)[0]).toEqual([NaN, NaN, 1, 2, 3]);
    expect(run("change(close)", data)[0]).toEqual([NaN, 1, 1, 1, 1]);
    expect(run("roc(close, 1)", bars([100, 110, 99]))[0].map(Math.round)).toEqual([NaN, 10, -10]);
  });

  it("tracks running extremes for drawdowns", () => {
    expect(run("(close / cummax(close) - 1) * 100", bars([100, 50, 75, 120, 90]))[0]).toEqual([0, -50, -25, 0, -25]);
    expect(run("cummin(close)", bars([3, 1, 2]))[0]).toEqual([3, 1, 1]);
  });

  it("computes RSI and handles one-way markets", () => {
    const rising = run("rsi(close, 3)", bars([1, 2, 3, 4, 5, 6]))[0];
    expect(rising.slice(3)).toEqual([100, 100, 100]);
    const mixed = run("rsi(close, 2)", bars([10, 11, 10, 11]))[0];
    expect(mixed.slice(2).every((v) => v > 0 && v < 100)).toBe(true);
  });

  it("supports elementwise helpers", () => {
    expect(run("max(close, 3)", data)[0]).toEqual([3, 3, 3, 4, 5]);
    expect(run("abs(close - 3)", data)[0]).toEqual([2, 1, 0, 1, 2]);
  });

  it("reads the benchmark close, NaN where it is missing", () => {
    const withBench = bars([10, 20], [{ bench: 100 }, {}]);
    expect(run("close / bench", withBench)[0]).toEqual([0.1, NaN]);
  });

  it("requires window lengths to be positive integers", () => {
    expect(() => run("sma(close, 2.5)", data)).toThrow("n 必须是正整数");
    expect(() => run("sma(close, close)", data)).toThrow("n 必须是正整数");
    expect(() => run("ref(close, 0)", data)).toThrow("n 必须是正整数");
  });
});

describe("formulaTemplate", () => {
  it("builds a KLineChart template whose calc maps lines to figure keys", async () => {
    const template = formulaTemplate({ id: "x1", label: "通道", source: "up = close + 1; dn = close - 1", pane: "main" })!;
    expect(template.name).toBe("F_x1");
    expect(template.series).toBe("price");
    expect(template.figures?.map((f) => f.key)).toEqual(["v0", "v1"]);
    const result = await template.calc(
      [
        { timestamp: 1, open: 1, high: 1, low: 1, close: 5 },
        { timestamp: 2, open: 1, high: 1, low: 1, close: 6 },
      ],
      template as never,
    );
    expect(result).toEqual([
      { v0: 6, v1: 4 },
      { v0: 7, v1: 5 },
    ]);
  });

  it("drops NaN so the chart leaves gaps", async () => {
    const template = formulaTemplate({ id: "x2", label: "均线", source: "sma(close, 2)", pane: "sub" })!;
    const result = await template.calc(
      [
        { timestamp: 1, open: 1, high: 1, low: 1, close: 5 },
        { timestamp: 2, open: 1, high: 1, low: 1, close: 7 },
      ],
      template as never,
    );
    expect(result).toEqual([{ v0: undefined }, { v0: 6 }]);
  });

  it("returns null for formulas that no longer compile", () => {
    expect(formulaTemplate({ id: "x3", label: "坏", source: "nope(", pane: "sub" })).toBeNull();
  });
});
