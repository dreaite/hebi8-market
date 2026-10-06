/**
 * Synthetic symbols: `=BTC/GOLD`, `="binance:BTCUSDT"/"tv:TVC:GOLD"`, `=2*(SPY-QQQ)`.
 * Operands are aliases or quoted keys; each OHLC field is computed separately, like a
 * TradingView spread. Trading days follow the first operand, the rest are forward-filled.
 */
import { align, type Bar } from "./series";
import { isValidKey } from "./symbols";

type Op = "+" | "-" | "*" | "/" | "^";
type Node =
  | { kind: "num"; value: number }
  | { kind: "sym"; key: string }
  | { kind: "neg"; arg: Node }
  | { kind: "bin"; op: Op; left: Node; right: Node };

export interface Synth {
  /** Referenced keys in order of appearance; the first one sets the trading days */
  keys: string[];
  node: Node;
}

type Token = { type: "num"; value: number } | { type: "sym"; key: string } | { type: "op"; value: string };

function tokenize(src: string, aliases: Record<string, string>): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error("无法识别的数字");
      tokens.push({ type: "num", value: Number(m[0]) });
      i += m[0].length;
    } else if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new Error("引号没有闭合");
      const key = src.slice(i + 1, end);
      if (!isValidKey(key)) throw new Error(`无效的标的 key「${key}」`);
      tokens.push({ type: "sym", key });
      i = end + 1;
    } else if (/[A-Za-z_]/.test(ch)) {
      const name = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(src.slice(i))![0];
      const key = aliases[name];
      if (!key) throw new Error(`未知别名「${name}」`);
      tokens.push({ type: "sym", key });
      i += name.length;
    } else if ("+-*/^()".includes(ch)) {
      tokens.push({ type: "op", value: ch });
      i++;
    } else {
      throw new Error(`无法识别的字符「${ch}」`);
    }
  }
  return tokens;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  private op(...values: string[]): string | null {
    const t = this.tokens[this.i];
    return t?.type === "op" && values.includes(t.value) ? t.value : null;
  }

  parse(): Node {
    const node = this.expr();
    if (this.i < this.tokens.length) throw new Error("表达式多了内容");
    return node;
  }

  private expr(): Node {
    let left = this.term();
    for (let op = this.op("+", "-"); op; op = this.op("+", "-")) {
      this.i++;
      left = { kind: "bin", op: op as Op, left, right: this.term() };
    }
    return left;
  }

  private term(): Node {
    let left = this.unary();
    for (let op = this.op("*", "/"); op; op = this.op("*", "/")) {
      this.i++;
      left = { kind: "bin", op: op as Op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    if (this.op("-")) {
      this.i++;
      return { kind: "neg", arg: this.unary() };
    }
    const base = this.primary();
    if (this.op("^")) {
      this.i++;
      return { kind: "bin", op: "^", left: base, right: this.unary() };
    }
    return base;
  }

  private primary(): Node {
    const t = this.tokens[this.i++];
    if (!t) throw new Error("表达式不完整");
    if (t.type === "num") return { kind: "num", value: t.value };
    if (t.type === "sym") return { kind: "sym", key: t.key };
    if (t.value === "(") {
      const inner = this.expr();
      if (!this.op(")")) throw new Error("缺少「)」");
      this.i++;
      return inner;
    }
    throw new Error(`这里不应出现「${t.value}」`);
  }
}

/** Parse the part after `=`; throws on unknown aliases or bad syntax. */
export function parseSynth(expr: string, aliases: Record<string, string>): Synth {
  const tokens = tokenize(expr, aliases);
  const keys = [...new Set(tokens.flatMap((t) => (t.type === "sym" ? [t.key] : [])))];
  if (keys.length === 0) throw new Error("合成表达式至少要引用一个标的");
  return { keys, node: new Parser(tokens).parse() };
}

const BIN: Record<Op, (a: number, b: number) => number> = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "^": (a, b) => a ** b,
};

function run(node: Node, env: Record<string, Bar>, field: "o" | "h" | "l" | "c"): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "sym":
      return env[node.key][field];
    case "neg":
      return -run(node.arg, env, field);
    case "bin":
      return BIN[node.op](run(node.left, env, field), run(node.right, env, field));
  }
}

/** Field-by-field evaluation; days before every operand has data are dropped. */
export function evalSynth(synth: Synth, series: Record<string, Bar[]>): Bar[] {
  const base = series[synth.keys[0]] ?? [];
  const aligned = synth.keys.map((k, i) => (i === 0 ? base : align(base, series[k] ?? [])));
  const out: Bar[] = [];
  for (let i = 0; i < base.length; i++) {
    const row = aligned.map((a) => a[i]);
    if (row.some((b) => b === null)) continue;
    const env = Object.fromEntries(synth.keys.map((k, j) => [k, row[j]!]));
    const o = run(synth.node, env, "o");
    const h = run(synth.node, env, "h");
    const l = run(synth.node, env, "l");
    const c = run(synth.node, env, "c");
    if (![o, h, l, c].every(Number.isFinite)) continue;
    // a ratio of highs is not the high of the ratio; keep the candle well-formed
    out.push({ t: base[i].t, o, h: Math.max(h, l, o, c), l: Math.min(l, h, o, c), c, v: null, adj: 1 });
  }
  return out;
}
