/**
 * A tiny expression language for user-defined indicators, evaluated over whole series.
 *
 *   fast = ema(close, 10); slow = ema(close, 40)      # two lines, the second may reuse the first
 *   (close / sma(close, 40) - 1) * 100                 # one unnamed line
 *
 * Statements are separated by `;` or newlines, `#` starts a comment. Each statement becomes a
 * plotted line; `name = expr` names it so later statements can refer to it.
 */

export type Series = number[];
type Value = Series | number;

export interface OhlcvBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  [key: string]: unknown;
}

export class FormulaError extends Error {
  constructor(
    message: string,
    readonly pos?: number,
  ) {
    super(message);
  }
}

type Token =
  | { type: "num"; value: number; pos: number }
  | { type: "ident"; value: string; pos: number }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "^"; pos: number }
  | { type: "(" | ")" | "," | "=" | "sep"; pos: number };

type Node =
  | { kind: "num"; value: number }
  | { kind: "var"; name: string; pos: number }
  | { kind: "call"; name: string; args: Node[]; pos: number }
  | { kind: "neg"; arg: Node }
  | { kind: "bin"; op: "+" | "-" | "*" | "/" | "^"; left: Node; right: Node };

interface Statement {
  name: string | null;
  expr: Node;
}

export interface Program {
  statements: Statement[];
  /** Legend title for each plotted line */
  outputs: string[];
}

// ---------------------------------------------------------------------------- built-ins

export const SERIES_VARS: Record<string, string> = {
  open: "开盘价",
  high: "最高价",
  low: "最低价",
  close: "收盘价",
  volume: "成交量",
  bench: "基准收盘价（需设置对比基准）",
  hl2: "(high + low) / 2",
  hlc3: "(high + low + close) / 3",
};

const isSeries = (v: Value): v is Series => Array.isArray(v);

function rolling(x: Series, n: number, fn: (window: Series) => number): Series {
  const out: Series = new Array(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    const window = x.slice(i - n + 1, i + 1);
    if (window.every(Number.isFinite)) out[i] = fn(window);
  }
  return out;
}

const mean = (w: Series) => w.reduce((a, b) => a + b, 0) / w.length;

function ema(x: Series, n: number): Series {
  const out: Series = new Array(x.length).fill(NaN);
  const alpha = 2 / (n + 1);
  let prev = NaN;
  let seen: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isFinite(v)) continue;
    if (Number.isNaN(prev)) {
      // seed with the simple average of the first n values
      seen.push(v);
      if (seen.length === n) {
        prev = mean(seen);
        out[i] = prev;
        seen = [];
      }
      continue;
    }
    prev = alpha * v + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

function rsi(x: Series, n: number): Series {
  const out: Series = new Array(x.length).fill(NaN);
  let gain = 0;
  let loss = 0;
  let count = 0;
  for (let i = 1; i < x.length; i++) {
    const diff = x[i] - x[i - 1];
    if (!Number.isFinite(diff)) {
      // gaps before warm-up (e.g. leading NaN of an inner sma) restart the average
      if (count < n) gain = loss = count = 0;
      continue;
    }
    const up = Math.max(diff, 0);
    const down = Math.max(-diff, 0);
    count++;
    if (count <= n) {
      gain += up / n;
      loss += down / n;
    } else {
      // Wilder smoothing
      gain = (gain * (n - 1) + up) / n;
      loss = (loss * (n - 1) + down) / n;
    }
    if (count >= n) out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function shift(x: Series, n: number): Series {
  return x.map((_, i) => (i - n >= 0 ? x[i - n] : NaN));
}

function running(x: Series, pick: (a: number, b: number) => number): Series {
  let acc = NaN;
  return x.map((v) => {
    if (Number.isFinite(v)) acc = Number.isNaN(acc) ? v : pick(acc, v);
    return acc;
  });
}

interface FnSpec {
  /** argument count, or [min, max] */
  arity: number | [number, number];
  /** indexes of arguments that must be positive integer window lengths */
  windows?: number[];
  hint: string;
  run: (args: Value[], len: number) => Value;
}

const toSeries = (v: Value, len: number): Series => (isSeries(v) ? v : new Array(len).fill(v));
const elementwise =
  (fn: (a: number) => number) =>
  ([x]: Value[]) =>
    isSeries(x) ? x.map(fn) : fn(x);
const pairwise =
  (fn: (a: number, b: number) => number) =>
  ([a, b]: Value[], len: number): Value => {
    if (!isSeries(a) && !isSeries(b)) return fn(a, b);
    const left = toSeries(a, len);
    const right = toSeries(b, len);
    return left.map((v, i) => fn(v, right[i]));
  };

export const FUNCTIONS: Record<string, FnSpec> = {
  sma: { arity: 2, windows: [1], hint: "sma(x, n) 简单均线", run: ([x, n], len) => rolling(toSeries(x, len), n as number, mean) },
  ema: { arity: 2, windows: [1], hint: "ema(x, n) 指数均线", run: ([x, n], len) => ema(toSeries(x, len), n as number) },
  std: {
    arity: 2,
    windows: [1],
    hint: "std(x, n) 滚动标准差",
    run: ([x, n], len) =>
      rolling(toSeries(x, len), n as number, (w) => {
        const m = mean(w);
        return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / w.length);
      }),
  },
  sum: {
    arity: 2,
    windows: [1],
    hint: "sum(x, n) 滚动求和",
    run: ([x, n], len) => rolling(toSeries(x, len), n as number, (w) => w.reduce((a, b) => a + b, 0)),
  },
  highest: {
    arity: 2,
    windows: [1],
    hint: "highest(x, n) n 根内最高",
    run: ([x, n], len) => rolling(toSeries(x, len), n as number, (w) => Math.max(...w)),
  },
  lowest: {
    arity: 2,
    windows: [1],
    hint: "lowest(x, n) n 根内最低",
    run: ([x, n], len) => rolling(toSeries(x, len), n as number, (w) => Math.min(...w)),
  },
  ref: { arity: 2, windows: [1], hint: "ref(x, n) n 根之前的值", run: ([x, n], len) => shift(toSeries(x, len), n as number) },
  change: {
    arity: [1, 2],
    windows: [1],
    hint: "change(x, n=1) 与 n 根前的差",
    run: ([x, n = 1], len) => {
      const s = toSeries(x, len);
      const prev = shift(s, n as number);
      return s.map((v, i) => v - prev[i]);
    },
  },
  roc: {
    arity: [1, 2],
    windows: [1],
    hint: "roc(x, n=1) 与 n 根前相比的涨跌 %",
    run: ([x, n = 1], len) => {
      const s = toSeries(x, len);
      const prev = shift(s, n as number);
      return s.map((v, i) => (v / prev[i] - 1) * 100);
    },
  },
  rsi: { arity: 2, windows: [1], hint: "rsi(x, n) 相对强弱指数", run: ([x, n], len) => rsi(toSeries(x, len), n as number) },
  cummax: { arity: 1, hint: "cummax(x) 历史最高", run: ([x], len) => running(toSeries(x, len), Math.max) },
  cummin: { arity: 1, hint: "cummin(x) 历史最低", run: ([x], len) => running(toSeries(x, len), Math.min) },
  max: { arity: 2, hint: "max(a, b) 逐根取大", run: pairwise(Math.max) },
  min: { arity: 2, hint: "min(a, b) 逐根取小", run: pairwise(Math.min) },
  abs: { arity: 1, hint: "abs(x)", run: elementwise(Math.abs) },
  sqrt: { arity: 1, hint: "sqrt(x)", run: elementwise(Math.sqrt) },
  log: { arity: 1, hint: "log(x) 自然对数", run: elementwise(Math.log) },
  exp: { arity: 1, hint: "exp(x)", run: elementwise(Math.exp) },
};

// ---------------------------------------------------------------------------- parsing

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\n" || ch === ";") {
      tokens.push({ type: "sep", pos: i++ });
    } else if (/\s/.test(ch)) {
      i++;
    } else if (ch === "#") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new FormulaError("无法识别的数字", i);
      tokens.push({ type: "num", value: Number(m[0]), pos: i });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))![0];
      tokens.push({ type: "ident", value: name, pos: i });
      i += name.length;
    } else if ("+-*/^".includes(ch)) {
      tokens.push({ type: "op", value: ch as "+", pos: i++ });
    } else if ("(),=".includes(ch)) {
      tokens.push({ type: ch as "(", pos: i++ });
    } else {
      throw new FormulaError(`无法识别的字符「${ch}」`, i);
    }
  }
  return tokens;
}

class Parser {
  private i = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly end: number,
  ) {}

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.i + offset];
  }

  private isOp(...ops: string[]): boolean {
    const t = this.peek();
    return t?.type === "op" && ops.includes(t.value);
  }

  private expect(type: ")"): void {
    const t = this.peek();
    if (t?.type !== type) throw new FormulaError(`缺少「${type}」`, t?.pos ?? this.end);
    this.i++;
  }

  program(): Statement[] {
    const statements: Statement[] = [];
    while (this.peek()) {
      if (this.peek()!.type === "sep") {
        this.i++;
        continue;
      }
      statements.push(this.statement());
      const t = this.peek();
      if (t && t.type !== "sep") throw new FormulaError("这里多了内容，语句之间用分号或换行分隔", t.pos);
    }
    return statements;
  }

  private statement(): Statement {
    const t = this.peek();
    if (t?.type === "ident" && this.peek(1)?.type === "=") {
      this.i += 2;
      return { name: t.value, expr: this.expr() };
    }
    return { name: null, expr: this.expr() };
  }

  private expr(): Node {
    let left = this.term();
    while (this.isOp("+", "-")) {
      const op = (this.tokens[this.i++] as { value: "+" | "-" }).value;
      left = { kind: "bin", op, left, right: this.term() };
    }
    return left;
  }

  private term(): Node {
    let left = this.unary();
    while (this.isOp("*", "/")) {
      const op = (this.tokens[this.i++] as { value: "*" | "/" }).value;
      left = { kind: "bin", op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.isOp("-")) {
      this.i++;
      return { kind: "neg", arg: this.unary() };
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Node {
    const base = this.primary();
    if (this.isOp("^")) {
      this.i++;
      return { kind: "bin", op: "^", left: base, right: this.unary() };
    }
    return base;
  }

  private primary(): Node {
    const t = this.tokens[this.i++];
    if (!t || t.type === "sep") throw new FormulaError("公式不完整", t?.pos ?? this.end);
    if (t.type === "num") return { kind: "num", value: t.value };
    if (t.type === "(") {
      const inner = this.expr();
      this.expect(")");
      return inner;
    }
    if (t.type === "ident") {
      if (this.peek()?.type !== "(") return { kind: "var", name: t.value, pos: t.pos };
      this.i++;
      const args: Node[] = [];
      if (this.peek()?.type !== ")") {
        args.push(this.expr());
        while (this.peek()?.type === ",") {
          this.i++;
          args.push(this.expr());
        }
      }
      this.expect(")");
      return { kind: "call", name: t.value.toLowerCase(), args, pos: t.pos };
    }
    throw new FormulaError(`这里不应出现「${t.type === "op" ? t.value : t.type}」`, t.pos);
  }
}

function check(node: Node, known: Set<string>): void {
  switch (node.kind) {
    case "num":
      return;
    case "var":
      if (!(node.name in SERIES_VARS) && !known.has(node.name)) {
        throw new FormulaError(`未知变量「${node.name}」`, node.pos);
      }
      return;
    case "neg":
      return check(node.arg, known);
    case "bin":
      check(node.left, known);
      return check(node.right, known);
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`未知函数「${node.name}」`, node.pos);
      const [min, max] = typeof fn.arity === "number" ? [fn.arity, fn.arity] : fn.arity;
      if (node.args.length < min || node.args.length > max) {
        throw new FormulaError(`${fn.hint}：参数个数不对`, node.pos);
      }
      node.args.forEach((arg) => check(arg, known));
    }
  }
}

/** Parse and validate; throws FormulaError with a position on bad input. */
export function compile(source: string): Program {
  const statements = new Parser(tokenize(source), source.length).program();
  if (statements.length === 0) throw new FormulaError("公式为空");
  const known = new Set<string>();
  statements.forEach((s) => {
    check(s.expr, known);
    if (s.name) known.add(s.name);
  });
  return {
    statements,
    outputs: statements.map((s, i) => s.name ?? (statements.length === 1 ? "值" : `L${i + 1}`)),
  };
}

// ---------------------------------------------------------------------------- evaluation

function baseSeries(name: string, data: OhlcvBar[]): Series {
  switch (name) {
    case "hl2":
      return data.map((d) => (d.high + d.low) / 2);
    case "hlc3":
      return data.map((d) => (d.high + d.low + d.close) / 3);
    case "volume":
      return data.map((d) => d.volume ?? NaN);
    case "bench":
      return data.map((d) => (typeof d.bench === "number" ? d.bench : NaN));
    default:
      return data.map((d) => d[name as "close"]);
  }
}

const BINARY: Record<string, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "^": (a, b) => a ** b,
};

/** Evaluate every statement; returns one series per plotted line (NaN where undefined). */
export function evaluate(program: Program, data: OhlcvBar[]): Series[] {
  const len = data.length;
  const env = new Map<string, Value>();
  const cache = new Map<string, Series>();

  const run = (node: Node): Value => {
    switch (node.kind) {
      case "num":
        return node.value;
      case "var": {
        const named = env.get(node.name);
        if (named !== undefined) return named;
        if (!cache.has(node.name)) cache.set(node.name, baseSeries(node.name, data));
        return cache.get(node.name)!;
      }
      case "neg": {
        const v = run(node.arg);
        return isSeries(v) ? v.map((x) => -x) : -v;
      }
      case "bin":
        return pairwise(BINARY[node.op])([run(node.left), run(node.right)], len);
      case "call": {
        const fn = FUNCTIONS[node.name];
        const args = node.args.map(run);
        for (const w of fn.windows ?? []) {
          if (w >= args.length) continue;
          const n = args[w];
          if (isSeries(n) || !Number.isInteger(n) || n < 1) {
            throw new FormulaError(`${fn.hint}：n 必须是正整数`, node.pos);
          }
        }
        return fn.run(args, len);
      }
    }
  };

  return program.statements.map((s) => {
    const series = toSeries(run(s.expr), len);
    if (s.name) env.set(s.name, series);
    return series;
  });
}
