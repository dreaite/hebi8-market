import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { describeCondition, observe, parseCondition, type AlertCondition } from "@/lib/alert-conds";
import { decideCondition, type StateRow } from "@/lib/alerts";
import { ConfigError, normalizeConfig } from "@/lib/config";
import type { Bar } from "@/lib/series";

const DAY = 86400;
const T0 = Date.UTC(2026, 0, 5) / 1000;
const bar = (c: number, i = 0): Bar => ({ t: T0 + i * DAY, o: c, h: c, l: c, c, v: 1, adj: 1 });
const closes = (...cs: number[]) => cs.map((c, i) => bar(c, i));

/** Feed a sequence of prices (one check each, same bar unless `newBar`) through a condition. */
function run(c: AlertCondition, trigger: "once" | "bar", prices: (number | [number, "new"])[]): boolean[] {
  let row: StateRow | undefined;
  let i = 0;
  return prices.map((p) => {
    if (Array.isArray(p)) i++;
    const price = Array.isArray(p) ? p[0] : p;
    const { fire, next } = decideCondition(c, trigger, row, observe(c, [bar(price, i)]), T0 + i * DAY);
    if (next) row = next;
    return fire;
  });
}

describe("alerts in hebi8.yaml", () => {
  const aliases = { BTC: "binance:BTCUSDT", SPY: "yahoo:SPY" };

  it("reads TradingView conditions, defaults to once and enabled, and labels them", () => {
    const cfg = normalizeConfig({
      aliases,
      alerts: [
        { key: "BTC", cond: "crossing_up", value: 130000 },
        { key: "SPY", cond: "entering", value: [520, 500], trigger: "bar" },
        { key: "yahoo:NVDA", cond: "moving_down_pct", value: { pct: 5, bars: 3 }, enabled: false, label: "三天跌 5%" },
      ],
    });
    expect(cfg.alerts[0]).toMatchObject({
      key: "binance:BTCUSDT",
      condition: { cond: "crossing_up", value: 130000 },
      when: null,
      tf: "D",
      trigger: "once",
      enabled: true,
      label: "BTC 上穿 130,000",
      text: "上穿 130,000",
    });
    expect(cfg.alerts[1]).toMatchObject({ condition: { cond: "entering", value: [500, 520] }, trigger: "bar", label: "SPY 进入通道 500 ~ 520" });
    expect(cfg.alerts[2]).toMatchObject({ enabled: false, label: "三天跌 5%", text: "三天跌 5%" });
    expect(describeCondition(cfg.alerts[2].condition!)).toBe("3 根 K 线内下跌 5%");
  });

  it("keeps the id when the trigger changes or the alert is paused", () => {
    const one = normalizeConfig({ aliases, alerts: [{ key: "BTC", cond: "greater", value: 1 }] }).alerts[0].id;
    const other = normalizeConfig({ aliases, alerts: [{ key: "binance:BTCUSDT", cond: "greater", value: 1, trigger: "bar", enabled: false }] }).alerts[0].id;
    expect(one).toMatch(/^alert:[0-9a-f]{6}$/);
    expect(other).toBe(one);
    expect(normalizeConfig({ aliases, alerts: [{ key: "BTC", cond: "greater", value: 2 }] }).alerts[0].id).not.toBe(one);
  });

  it.each([
    [{ key: "BTC" }, "需要 cond"],
    [{ key: "BTC", cond: "greater", value: 1, when: "close > 1" }, "只能写一个"],
    [{ key: "BTC", cond: "sideways", value: 1 }, "未知的条件"],
    [{ key: "BTC", cond: "greater", value: "high" }, "价格"],
    [{ key: "BTC", cond: "inside", value: [1] }, "[低, 高]"],
    [{ key: "BTC", cond: "moving_up_pct", value: { pct: 3, bars: 1.5 } }, "正整数"],
    [{ key: "BTC", cond: "greater", value: 1, trigger: "always" }, "trigger"],
    [{ key: "BTC", cond: "greater", value: 1, enabled: "no" }, "enabled"],
  ])("rejects %j", (alert, msg) => {
    expect(() => normalizeConfig({ aliases, alerts: [alert] })).toThrow(ConfigError);
    expect(() => normalizeConfig({ aliases, alerts: [alert] })).toThrow(msg);
  });
});

describe("TradingView conditions", () => {
  const at = (cond: string, value: unknown) => parseCondition(cond, value);

  it("crossing up / down / either compare with the previous check; the first one only records", () => {
    expect(run(at("crossing_up", 100), "bar", [101, 99, 101, 102, 99])).toEqual([false, false, true, false, false]);
    expect(run(at("crossing_down", 100), "bar", [99, 101, [99, "new"], 101])).toEqual([false, false, true, false]);
    expect(run(at("crossing", 100), "bar", [99, [101, "new"], [99, "new"]])).toEqual([false, true, true]);
  });

  it("entering / exiting a channel are events too", () => {
    expect(run(at("entering", [90, 110]), "bar", [120, 100, [120, "new"], [105, "new"]])).toEqual([false, true, false, true]);
    expect(run(at("exiting", [90, 110]), "bar", [100, 80, [100, "new"], [111, "new"]])).toEqual([false, true, false, true]);
  });

  it("greater / less / inside / outside fire whenever they hold, the first check included", () => {
    expect(run(at("greater", 100), "bar", [101])).toEqual([true]);
    expect(run(at("less", 100), "bar", [101, 99])).toEqual([false, true]);
    expect(run(at("inside", [90, 110]), "bar", [95])).toEqual([true]);
    expect(run(at("outside", [90, 110]), "bar", [95, 111])).toEqual([false, true]);
  });

  it("bar fires at most once per daily bar; the next bar fires again", () => {
    expect(run(at("greater", 100), "bar", [101, 102, 103, [104, "new"], 105])).toEqual([true, false, false, true, false]);
  });

  it("moving up / down % look back `bars` daily bars", () => {
    const up = at("moving_up_pct", { pct: 10, bars: 2 });
    expect(observe(up, closes(100, 105, 109))).toBe(0);
    expect(observe(up, closes(100, 105, 110))).toBe(1);
    expect(observe(up, closes(105, 110))).toBeNull(); // not enough history
    const down = at("moving_down_pct", { pct: 10, bars: 1 });
    expect(observe(down, closes(100, 90))).toBe(1);
    expect(observe(down, closes(100, 91))).toBe(0);
  });
});

// ---------------------------------------------------------------------------- polling and judging

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-quotes-"));
const root = path.join(dir, "vault");
const bob = path.join(root, "users", "bob");
const BTC = "binance:BTCUSDT";
const SPY = "yahoo:SPY";

beforeAll(async () => {
  process.env.HEBI8_DB = path.join(dir, "hebi8.db");
  process.env.HEBI8_VAULT = root;
  process.env.HEBI8_SECRETS = path.join(dir, "secrets");
  fs.mkdirSync(bob, { recursive: true });
  const { ensureSymbol, markSynced } = await import("@/lib/store");
  for (const key of [BTC, SPY, "tv:TVC:GOLD"]) {
    ensureSymbol(key);
    markSynced(key, { timezone: key === SPY ? "America/New_York" : "UTC" });
  }
});

afterAll(() => {
  delete process.env.HEBI8_DB;
  delete process.env.HEBI8_VAULT;
  delete process.env.HEBI8_SECRETS;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("quote polling", () => {
  it("polls every enabled alert's symbols, synthetic operands and formula references, but not datasets", async () => {
    const { quoteKeys } = await import("@/lib/quotes");
    const cfg = normalizeConfig({
      aliases: { BTC, GOLD: "tv:TVC:GOLD" },
      alerts: [
        { key: "=BTC/GOLD", cond: "greater", value: 30 },
        { key: SPY, when: 'close > close("yahoo:QQQ")' },
        { key: "data:gpu/4090", cond: "less", value: 11000 },
        { key: "yahoo:NVDA", cond: "less", value: 1, enabled: false },
      ],
    });
    expect(quoteKeys([cfg]).sort()).toEqual([BTC, "tv:TVC:GOLD", "yahoo:QQQ", SPY].sort());
  });

  it("asks new symbols at once, open and always ones every 5 minutes, the rest hourly", async () => {
    const { dueKeys } = await import("@/lib/quotes");
    const now = 1_800_000_000_000;
    const seen = new Map([
      ["open", { at: now - 5 * 60_000, session: "open" as const }],
      ["crypto", { at: now - 4.6 * 60_000, session: "always" as const }],
      ["fresh", { at: now - 60_000, session: "open" as const }],
      ["closed", { at: now - 30 * 60_000, session: "closed" as const }],
      ["post", { at: now - 60 * 60_000, session: "post" as const }],
    ]);
    expect(dueKeys(["new", "open", "crypto", "fresh", "closed", "post"], seen, now)).toEqual(["new", "open", "crypto", "post"]);
  });

  it("builds today's bar in memory from the quote and never writes it to bars", async () => {
    const { withQuote } = await import("@/lib/quotes");
    const daily = closes(100, 101);
    const day2 = T0 + DAY;
    const quote = (price: number, time: number, extra = {}) => ({ key: BTC, price, time, session: "always" as const, fetchedAt: 2_000_000_000_000, ...extra });
    // same trading day as the last bar: it is extended, not duplicated
    expect(withQuote(daily, quote(104, day2 + 3600, { dayHigh: 105, dayLow: 98 }), "UTC", null)).toEqual([daily[0], { t: day2, o: 101, h: 105, l: 98, c: 104, v: 1, adj: 1 }]);
    // a new day: appended, opening at the first price polling saw
    const next = withQuote(daily, quote(103, day2 + DAY + 600), "UTC", null, { t: day2 + DAY, o: 102, h: 103.5, l: 101.5 });
    expect(next.at(-1)).toEqual({ t: day2 + DAY, o: 102, h: 103.5, l: 101.5, c: 103, v: null, adj: 1 });
    // a daily sync after the quote wins
    expect(withQuote(daily, quote(104, day2 + DAY), "UTC", 3_000_000_000_000)).toBe(daily);
  });

  describe("rounds", () => {
    let calls: { source: string; tickers: string[] }[];
    let fail: Record<string, boolean>;
    let prices: Record<string, number>;

    beforeEach(async () => {
      const { adapters } = await import("@/lib/sources");
      const { resetQuotes } = await import("@/lib/quotes");
      const { getDb } = await import("@/lib/db");
      getDb().exec("DELETE FROM quotes; DELETE FROM alert_state;");
      resetQuotes();
      calls = [];
      fail = {};
      prices = { BTCUSDT: 105, SPY: 500 };
      for (const [source, session] of [["binance", "always"], ["yahoo", "closed"]] as const) {
        vi.spyOn(adapters[source], "quotes").mockImplementation(async (tickers) => {
          calls.push({ source, tickers });
          if (fail[source]) throw new Error(`${source} down`);
          const now = Math.floor(Date.now() / 1000);
          return Object.fromEntries(tickers.filter((t) => t in prices).map((t) => [t, { price: prices[t], time: now, session }]));
        });
      }
    });

    const vaultsWith = (rootAlerts: unknown[], bobAlerts: unknown[] = []) => {
      const yaml = (alerts: unknown[]) => `# 警报\naliases:\n  BTC: ${BTC} # 比特币\nalerts:\n${alerts.map((a) => `  - ${JSON.stringify(a)} # 保留这条注释\n`).join("")}`;
      fs.writeFileSync(path.join(root, "hebi8.yaml"), yaml(rootAlerts));
      fs.writeFileSync(path.join(bob, "hebi8.yaml"), yaml(bobAlerts));
      return [
        { id: "", dir: root, config: normalizeConfig({ aliases: { BTC }, alerts: rootAlerts }) },
        { id: "bob", dir: bob, config: normalizeConfig({ aliases: { BTC }, alerts: bobAlerts }) },
      ];
    };

    it("fetches each source in one batch, then only what is due", async () => {
      const { quoteRound } = await import("@/lib/quotes");
      const { readDaily, readQuotes, writeBars } = await import("@/lib/store");
      writeBars(BTC, closes(100, 101), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 1000 }, { key: SPY, cond: "less", value: 1 }]);
      const now = Date.now();
      await quoteRound(now, vaults);
      expect(calls).toEqual([
        { source: "binance", tickers: ["BTCUSDT"] },
        { source: "yahoo", tickers: ["SPY"] },
      ]);
      expect(Object.keys(readQuotes()).sort()).toEqual([BTC, SPY]);
      expect(readDaily(BTC)).toHaveLength(2);

      calls = [];
      await quoteRound(now + 60_000, vaults);
      expect(calls).toEqual([]);
      await quoteRound(now + 5 * 60_000, vaults);
      expect(calls).toEqual([{ source: "binance", tickers: ["BTCUSDT"] }]); // SPY is closed: hourly
      calls = [];
      await quoteRound(now + 60 * 60_000, vaults);
      expect(calls.map((c) => c.source).sort()).toEqual(["binance", "yahoo"]);
    });

    it("backs a failing source off to hourly after a few failures, without stopping the others", async () => {
      const { quoteRound } = await import("@/lib/quotes");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 1000 }, { key: SPY, cond: "less", value: 1 }]);
      const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
      fail.yahoo = true;
      const now = Date.now();
      for (let i = 0; i < 4; i++) await quoteRound(now + i * 5 * 60_000, vaults);
      expect(calls.filter((c) => c.source === "yahoo")).toHaveLength(3);
      expect(calls.filter((c) => c.source === "binance")).toHaveLength(4);
      expect(logs.mock.calls.flat().filter((m) => String(m).includes("yahoo failed"))).toHaveLength(1);
      await quoteRound(now + 3 * 5 * 60_000 + 60 * 60_000, vaults);
      expect(calls.filter((c) => c.source === "yahoo")).toHaveLength(4);
      logs.mockRestore();
    });

    it("judges each vault on the live bar; once switches itself off in the yaml, comments kept", async () => {
      const { quoteRound } = await import("@/lib/quotes");
      const { readConfig } = await import("@/lib/vault");
      const { readDaily, writeBars } = await import("@/lib/store");
      const { getDb } = await import("@/lib/db");
      const { runAlerts } = await import("@/lib/alerts");
      writeBars(BTC, closes(100, 101), "replace");
      // root: a state alert that holds now; bob: an event that needs a cross
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 104 }], [{ key: "BTC", cond: "crossing_up", value: 110, trigger: "bar" }]);
      getDb().prepare("INSERT INTO alert_state (vault, rule, key, state) VALUES ('', 'cond:keep', ?, 0)").run(BTC);
      const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const now = Date.now();

      await quoteRound(now, vaults);
      const rootYaml = fs.readFileSync(path.join(root, "hebi8.yaml"), "utf8");
      expect(rootYaml).toContain("enabled: false");
      expect(rootYaml).toContain("# 保留这条注释");
      expect(rootYaml).toContain("# 比特币");
      expect(readConfig(root).alerts[0].enabled).toBe(false);
      expect(readConfig(bob).alerts[0].enabled).toBe(true);
      expect(logs.mock.calls.flat().join("\n")).toMatch(/1 new alert\(s\): binance:BTCUSDT/);
      // a quote round leaves the notify conditions' rows alone
      expect(getDb().prepare("SELECT vault, rule FROM alert_state ORDER BY vault, rule").all()).toEqual([
        { vault: "", rule: vaults[0].config.alerts[0].id },
        { vault: "", rule: "cond:keep" },
        { vault: "bob", rule: vaults[1].config.alerts[0].id },
      ]);

      // bob's cross: below 110 at the first check, above it now
      prices.BTCUSDT = 111;
      const bobOnly = [{ ...vaults[0], config: readConfig(root) }, vaults[1]];
      const events = await Promise.all([runAlerts(bobOnly[1], bobOnly[1].config, new Map(), (await import("@/lib/quotes")).liveReader())]);
      expect(events[0]).toEqual([]); // the stored quote is still 105
      await quoteRound(now + 5 * 60_000, bobOnly);
      expect(logs.mock.calls.flat().join("\n")).toMatch(/1 new alert\(s\) \(bob\): binance:BTCUSDT/);
      expect(readConfig(bob).alerts[0].enabled).toBe(true); // bar: stays on
      expect(readDaily(BTC)).toHaveLength(2);
      logs.mockRestore();
    });
  });
});
