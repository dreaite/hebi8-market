import { describe, expect, it } from "vitest";
import { compile, evaluate, FormulaError, type OhlcvBar, type RefSeries } from "@/indicators/formula";
import { formulaTemplate } from "@/indicators/formula-indicators";

const bars = (closes: number[], extra: Partial<OhlcvBar>[] = []): OhlcvBar[] =>
  closes.map((close, i) => ({ open: close, high: close + 1, low: close - 1, close, volume: 10, ...extra[i] }));

const run = (source: string, data: OhlcvBar[], refs?: Record<string, RefSeries>, opts = {}) =>
  evaluate(compile(source, opts), { bars: data, refs });
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
    ['"yahoo:SPY" + 1', "字符串只能用在"],
    ["close(NOPE)", "未知别名「NOPE」"],
    ["close(sma(close, 2))", "应是别名"],
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

  it("resolves symbol references through aliases and quotes, and reports them", () => {
    const program = compile('close(QQQ) / close("tv:TVC:GOLD") + open(QQQ)', { aliases: { QQQ: "yahoo:QQQ" } });
    expect(program.refs).toEqual(["yahoo:QQQ", "tv:TVC:GOLD"]);
    expect(program.benchKey).toBeNull();
  });

  it("maps bench to the configured benchmark", () => {
    const program = compile("close / close(bench) + bench", { bench: "yahoo:SPY" });
    expect(program.refs).toEqual(["yahoo:SPY"]);
    expect(program.benchKey).toBe("yahoo:SPY");
    expect(() => compile("close / bench", { bench: null })).toThrow("未设置基准");
    expect(compile("close / bench").refs).toEqual([]); // bench unknown: allowed, evaluates to NaN
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
    expect(run("tr", data)[0]).toEqual([2, 2, 2, 2, 2]);
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

  it("evaluates comparisons and logic as 0/1 with NaN passthrough", () => {
    expect(run("close > 2", data)[0]).toEqual([0, 0, 1, 1, 1]);
    expect(run("close >= 2 and close <= 4", data)[0]).toEqual([0, 1, 1, 1, 0]);
    expect(run("close == 1 or close != 5", data)[0]).toEqual([1, 1, 1, 1, 0]);
    expect(run("not close > 2", data)[0]).toEqual([1, 1, 0, 0, 0]);
    // not binds tighter than and, which binds tighter than or; all below arithmetic
    expect(run("not close > 4 and close + 1 > 2 or close == 5", data)[0]).toEqual([0, 1, 1, 1, 1]);
    expect(run("sma(close, 2) > 2", data)[0]).toEqual([NaN, 0, 1, 1, 1]);
  });

  it("reads other symbols aligned to the bars", () => {
    const refs = { "yahoo:QQQ": { c: [null, 10, 20, 20, 40], o: [null, 1, 2, 3, 4] } };
    const aliases = { QQQ: "yahoo:QQQ" };
    expect(run("close(QQQ)", data, refs, { aliases })[0]).toEqual([NaN, 10, 20, 20, 40]);
    expect(run('open("yahoo:QQQ") * 10', data, refs)[0]).toEqual([NaN, 10, 20, 30, 40]);
    expect(run("high(QQQ)", data, refs, { aliases })[0]).toEqual([NaN, NaN, NaN, NaN, NaN]);
    expect(run("close / close(bench)", data, refs, { bench: "yahoo:QQQ" })[0]).toEqual([NaN, 0.2, 0.15, 0.2, 0.125]);
    expect(run("bench", data, refs, { bench: "yahoo:QQQ" })[0]).toEqual([NaN, 10, 20, 20, 40]);
    expect(run("close(QQQ)", data, {}, { aliases })[0]).toEqual([NaN, NaN, NaN, NaN, NaN]);
  });

  it("offers iff, cross and barssince", () => {
    expect(run("iff(close > 3, 1, -1)", data)[0]).toEqual([-1, -1, -1, 1, 1]);
    expect(run("cross(close, 2.5)", data)[0]).toEqual([NaN, 0, 1, 0, 0]);
    // needs both bars of each side: the sma warm-up leaves the second bar undefined
    expect(run("cross(close, sma(close, 2))", bars([5, 1, 9, 9]))[0]).toEqual([NaN, NaN, 1, 0]);
    expect(run("barssince(close == 2)", data)[0]).toEqual([NaN, 0, 1, 2, 3]);
  });

  it("offers atr, corr and pctrank", () => {
    expect(run("atr(2)", data)[0]).toEqual([NaN, 2, 2, 2, 2]);
    expect(round(run("corr(close, close * 2, 3)", data)[0])).toEqual([NaN, NaN, 1, 1, 1]);
    expect(round(run("corr(close, -close, 3)", data)[0])).toEqual([NaN, NaN, -1, -1, -1]);
    expect(run("pctrank(close, 2)", bars([1, 3, 2, 5, 0]))[0]).toEqual([NaN, NaN, 50, 100, 0]);
  });

  it("requires window lengths to be positive integers", () => {
    expect(() => run("sma(close, 2.5)", data)).toThrow("n 必须是正整数");
    expect(() => run("sma(close, close)", data)).toThrow("n 必须是正整数");
    expect(() => run("ref(close, 0)", data)).toThrow("n 必须是正整数");
  });
});

describe("formulaTemplate", () => {
  const def = (id: string, formula: string, pane: "main" | "sub" = "main") => ({ id, label: "t", formula, pane });

  it("builds a KLineChart template whose calc maps lines to figure keys", async () => {
    const d = def("x1", "up = close + 1; dn = close - 1");
    const template = formulaTemplate(d, compile(d.formula), {});
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

  it("drops NaN so the chart leaves gaps, and reads refs through the closure", async () => {
    const d = def("x2", "sma(close, 2) + close(QQQ)", "sub");
    const program = compile(d.formula, { aliases: { QQQ: "yahoo:QQQ" } });
    const template = formulaTemplate(d, program, { "yahoo:QQQ": { c: [1, 1] } });
    expect(template.series).toBe("normal");
    const result = await template.calc(
      [
        { timestamp: 1, open: 1, high: 1, low: 1, close: 5 },
        { timestamp: 2, open: 1, high: 1, low: 1, close: 7 },
      ],
      template as never,
    );
    expect(result).toEqual([{ v0: undefined }, { v0: 7 }]);
  });
});
