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

  it("crossings are strict like cross(): touching the line is not crossing it", () => {
    const up = at("crossing_up", 100);
    const down = at("crossing_down", 100);
    expect(run(up, "bar", [99, 100])).toEqual([false, false]);
    expect(run(up, "bar", [100, 101])).toEqual([false, true]);
    expect(run(down, "bar", [101, 100])).toEqual([false, false]);
    expect(run(down, "bar", [100, 99])).toEqual([false, true]);
    expect(run(at("crossing", 100), "bar", [99, 100, [101, "new"], [100, "new"], [99, "new"]])).toEqual([false, false, true, false, true]);
  });

  it("entering / exiting a channel need the strict inside / outside; an edge is neither", () => {
    const enter = at("entering", [90, 110]);
    const exit = at("exiting", [90, 110]);
    expect(run(enter, "bar", [120, 110])).toEqual([false, false]);
    expect(run(enter, "bar", [110, 109])).toEqual([false, true]);
    expect(run(exit, "bar", [100, 110])).toEqual([false, false]);
    expect(run(exit, "bar", [110, 111])).toEqual([false, true]);
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

  it("puts a quote on the local day of its trade: crypto on the UTC day, a stock on the exchange's date", async () => {
    const { withQuote } = await import("@/lib/quotes");
    const day = Date.UTC(2026, 9, 6) / 1000;
    const daily = [bar(100, 0), { ...bar(101, 0), t: day }];
    const quote = (time: number, session: "always" | "open" | "post") => ({ key: BTC, price: 102, time, session, fetchedAt: 2_000_000_000_000 });
    // 13:00 UTC Binance: the same UTC day, not the next one
    expect(withQuote(daily, quote(day + 13 * 3600, "always"), "UTC", null).map((b) => b.t)).toEqual([T0, day]);
    // 15:00 and 21:00 in New York (19:00 and 01:00 UTC): still the exchange's Oct 6
    expect(withQuote(daily, quote(day + 19 * 3600, "open"), "America/New_York", null).map((b) => b.t)).toEqual([T0, day]);
    expect(withQuote(daily, quote(day + 25 * 3600, "post"), "America/New_York", null).map((b) => b.t)).toEqual([T0, day]);
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

  it("takes the day's open and volume from the source when it reports them", async () => {
    const { withQuote } = await import("@/lib/quotes");
    const daily = closes(100, 101);
    const day2 = T0 + DAY;
    const quote = { key: SPY, price: 104, time: day2 + DAY + 600, session: "open" as const, fetchedAt: 2_000_000_000_000, dayOpen: 99, dayHigh: 105, dayLow: 98.5, dayVolume: 12345 };
    // a new day: the source's open, not the first price polling saw; its volume instead of none
    expect(withQuote(daily, quote, "UTC", null, { t: day2 + DAY, o: 102, h: 103, l: 101.5 }).at(-1)).toEqual({ t: day2 + DAY, o: 99, h: 105, l: 98.5, c: 104, v: 12345, adj: 1 });
    // the same day as the synced bar: the source's figures replace the bar's
    expect(withQuote(daily, { ...quote, time: day2 + 600 }, "UTC", null).at(-1)).toEqual({ t: day2, o: 99, h: 105, l: 98.5, c: 104, v: 12345, adj: 1 });
    // an open outside the reported range still lies inside the bar
    expect(withQuote(daily, { ...quote, dayOpen: 106 }, "UTC", null).at(-1)).toMatchObject({ o: 106, h: 106 });
  });

  it("reads Binance's UTC trading day: open, high, low and volume of the daily bar", async () => {
    const { binance } = await import("@/lib/sources/binance");
    const closeTime = Date.UTC(2100, 0, 1) - 1;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([{ symbol: "BTCUSDT", openPrice: "82635.56", highPrice: "82892.01", lowPrice: "82545.82", lastPrice: "82756.00", volume: "1856.70133", closeTime }])),
    );
    const before = Math.floor(Date.now() / 1000);
    const quotes = await binance.quotes!(["BTCUSDT"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/v3/ticker/tradingDay?type=MINI&symbols=%5B%22BTCUSDT%22%5D");
    expect(quotes.BTCUSDT).toMatchObject({ price: 82756, dayOpen: 82635.56, dayHigh: 82892.01, dayLow: 82545.82, dayVolume: 1856.70133, session: "always" });
    // the day's end is not the time of the trade
    expect(quotes.BTCUSDT.time).toBeGreaterThanOrEqual(before);
    expect(quotes.BTCUSDT.time).toBeLessThan(before + 60);
    fetchMock.mockRestore();
  });

  it("puts Sunday evening overnight quotes on Monday, matching the daily bars", async () => {
    const { withQuote } = await import("@/lib/quotes");
    const monday = Date.UTC(2026, 9, 5) / 1000;
    const time = Date.parse("2026-10-04T22:00:00Z") / 1000; // Sunday 18:00 New York
    const daily = [{ ...bar(100), t: monday }];
    for (const [key, zone, kind] of [["tv:TVC:GOLD", "America/New_York", "cfd"], ["tv:FX_IDC:EURUSD", "Etc/UTC", "forex"], ["tv:CME_MINI:ES1!", "America/New_York", "futures"]]) {
      const quote = { key, price: 110, time, session: "open" as const, fetchedAt: Date.now() };
      const live = withQuote(daily, quote, zone, null, undefined, kind);
      expect(live).toHaveLength(1);
      expect(live[0]).toMatchObject({ t: monday, c: 110 });
      expect(withQuote([{ ...bar(100), t: monday - 3 * DAY }], quote, zone, null, undefined, kind).map((b) => b.t)).toEqual([monday - 3 * DAY, monday]);
      // Monday afternoon stays on Monday, instead of rolling over at noon.
      expect(withQuote(daily, { ...quote, time: Date.parse("2026-10-05T19:00:00Z") / 1000 }, zone, null, undefined, kind)[0].t).toBe(monday);
    }
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

    it("stamps a quote when it arrives, so a daily sync that ends during the request does not hide it", async () => {
      const { adapters } = await import("@/lib/sources");
      const { quoteRound, liveReader } = await import("@/lib/quotes");
      const { getSymbol, markSynced, readQuotes, writeBars } = await import("@/lib/store");
      writeBars(BTC, closes(100, 101), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 1000 }]);
      vi.spyOn(adapters.binance, "quotes").mockImplementation(async () => {
        markSynced(BTC, { timezone: "UTC" }); // the daily sync finishes while the quote is on its way
        await new Promise((r) => setTimeout(r, 5));
        return { BTCUSDT: { price: 123, time: Math.floor(Date.now() / 1000), session: "always" } };
      });
      await quoteRound(Date.now(), vaults);
      expect(readQuotes()[BTC].fetchedAt).toBeGreaterThan(getSymbol(BTC)!.syncedAt!);
      expect(liveReader()(BTC).at(-1)?.c).toBe(123);
    });

    it("loads the config when a run starts: a once alert fires once, an alert paused in the queue holds", async () => {
      const { runAlerts, setAlertsEnabled } = await import("@/lib/alerts");
      const { readConfig } = await import("@/lib/vault");
      const { writeBars } = await import("@/lib/store");
      writeBars(BTC, closes(100, 101), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 50 }], [{ key: "BTC", cond: "greater", value: 50 }]);
      const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const load = (d: string) => () => readConfig(d);

      // a daily sync and a quote round queued together
      const both = await Promise.all([runAlerts(vaults[0], load(root)), runAlerts(vaults[0], load(root))]);
      expect(both.map((events) => events.length)).toEqual([1, 0]);
      expect(readConfig(root).alerts[0].enabled).toBe(false);

      // bob pauses his alert while his run waits behind another one
      const ahead = runAlerts(vaults[0], load(root));
      const queued = runAlerts(vaults[1], load(bob));
      setAlertsEnabled(bob, [vaults[1].config.alerts[0].id], false);
      await ahead;
      expect(await queued).toEqual([]);
      logs.mockRestore();
    });

    it("judges the whole watchlist after a daily sync only; quote rounds keep its rows, old cond: rows continue", async () => {
      const { runAlerts, readState, stateId } = await import("@/lib/alerts");
      const { liveReader } = await import("@/lib/quotes");
      const { readConfig, updateConfig } = await import("@/lib/vault");
      const { writeBars } = await import("@/lib/store");
      const { getDb } = await import("@/lib/db");
      writeBars(BTC, closes(100, 101), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 1000 }]);
      updateConfig(root, (doc) => {
        doc.set("groups", [{ name: "Crypto", symbols: ["BTC"] }]);
        doc.set("conditions", [{ id: "gate", label: "Above", formula: "close > ref(close, 1)", tf: "D" }]);
      });
      getDb().prepare("INSERT INTO alert_state (vault, rule, key, state) VALUES ('', 'cond:gate', ?, 0)").run(BTC);
      const load = () => readConfig(root);
      const rules = () => [...readState("").keys()].map((k) => k.split("\u0000")[0]).sort();
      const [alertId] = vaults[0].config.alerts.map((a) => a.id);

      // any pass renames the old row first; a quote round does not judge the watchlist
      await runAlerts(vaults[0], load, "quotes", liveReader());
      expect(rules()).toEqual([alertId, "alert:gate"].sort());
      expect(readState("").get(stateId("alert:gate", BTC))).toMatchObject({ state: 0, firedAt: null });
      // it was false before the upgrade and holds now: a turn, not a first sighting
      await runAlerts(vaults[0], load);
      expect(rules()).toEqual([alertId, "alert:gate"].sort());
      expect(readState("").get(stateId("alert:gate", BTC))).toMatchObject({ state: 1, firedAt: expect.any(Number) });
      await runAlerts(vaults[0], load, "quotes", liveReader());
      expect(rules()).toEqual([alertId, "alert:gate"].sort());
    });

    it("a committed once alert only retries its yaml switch-off; unrelated writes and manual enabling do not re-arm it", async () => {
      const { forgetAlerts, runAlerts, setAlertsEnabled } = await import("@/lib/alerts");
      const { readConfig, updateConfig } = await import("@/lib/vault");
      const { writeBars } = await import("@/lib/store");
      const { getDb } = await import("@/lib/db");
      writeBars(BTC, closes(100, 101), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 50 }]);
      const alertId = vaults[0].config.alerts[0].id;
      const logs = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
        throw new Error("ENOSPC");
      });
      expect(await runAlerts(vaults[0], () => readConfig(root))).toHaveLength(1);
      rename.mockRestore();
      expect(readConfig(root).alerts[0].enabled).toBe(true);
      const firedAt = getDb().prepare("SELECT fired_at FROM alert_state WHERE rule = ?").get(alertId);
      updateConfig(root, (doc) => doc.set("updown", "red-up"));
      expect(await runAlerts(vaults[0], () => readConfig(root))).toEqual([]);
      expect(readConfig(root).alerts[0].enabled).toBe(false);
      expect(getDb().prepare("SELECT fired_at FROM alert_state WHERE rule = ?").get(alertId)).toEqual(firedAt);
      setAlertsEnabled(root, [alertId], true); // hand-written enabled: true retains the firing
      expect(await runAlerts(vaults[0], () => readConfig(root))).toEqual([]);
      expect(readConfig(root).alerts[0].enabled).toBe(false);
      setAlertsEnabled(root, [alertId], true);
      forgetAlerts("", [alertId]); // the UI's restore starts over
      expect(await runAlerts(vaults[0], () => readConfig(root))).toHaveLength(1);
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
      expect(getDb().prepare("SELECT vault, rule FROM alert_state ORDER BY vault, rule").all()).toEqual([
        { vault: "", rule: vaults[0].config.alerts[0].id },
        { vault: "bob", rule: vaults[1].config.alerts[0].id },
      ]);

      // bob's cross: below 110 at the first check, above it now
      prices.BTCUSDT = 111;
      const bobOnly = [{ ...vaults[0], config: readConfig(root) }, vaults[1]];
      const events = await Promise.all([runAlerts(bobOnly[1], () => bobOnly[1].config, "quotes", (await import("@/lib/quotes")).liveReader())]);
      expect(events[0]).toEqual([]); // the stored quote is still 105
      await quoteRound(now + 5 * 60_000, bobOnly);
      expect(logs.mock.calls.flat().join("\n")).toMatch(/1 new alert\(s\) \(bob\): binance:BTCUSDT/);
      expect(readConfig(bob).alerts[0].enabled).toBe(true); // bar: stays on
      expect(readDaily(BTC)).toHaveLength(2);
      logs.mockRestore();
    });

    it("the chart's last bar is today's live one, with the bench aligned to it", async () => {
      const { quoteRound } = await import("@/lib/quotes");
      const { writeBars } = await import("@/lib/store");
      const { NextRequest } = await import("next/server");
      const { GET } = await import("@/app/api/bars/route");
      writeBars(BTC, closes(100, 101), "replace");
      writeBars(SPY, closes(400, 410), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 1000 }]);
      fs.appendFileSync(path.join(root, "hebi8.yaml"), `groups:\n  - symbols:\n      - key: BTC\n        bench: ${SPY}\n`);
      await quoteRound(Date.now(), vaults);
      const res = await GET(new NextRequest(`http://h/api/bars?key=${encodeURIComponent(BTC)}&tf=D`));
      const body = await res.json();
      expect(body.bars).toHaveLength(3);
      expect(body.bars.at(-1)).toMatchObject({ open: 105, close: 105, bench: 410 });
      expect(body.symbol).toMatchObject({ session: "always", lastDay: body.bars.at(-1).timestamp });
    });

    it("/api/status gives an open chart its last bar on any timeframe, with the bench at it", async () => {
      const { writeBars, writeQuotes } = await import("@/lib/store");
      const { NextRequest } = await import("next/server");
      const { GET } = await import("@/app/api/status/route");
      // Monday Jan 5 and Tuesday Jan 6, then a quote on Wednesday with the source's open and volume
      writeBars(BTC, [{ ...bar(100, 0), h: 103, l: 99 }, bar(101, 1)], "replace");
      writeBars(SPY, closes(400, 410), "replace");
      const quote = { key: BTC, price: 150, time: T0 + 2 * DAY + 3600, session: "always" as const, fetchedAt: Date.now(), dayOpen: 102, dayHigh: 151, dayLow: 98, dayVolume: 7 };
      writeQuotes([quote]);
      vaultsWith([]);
      fs.appendFileSync(path.join(root, "hebi8.yaml"), `groups:\n  - symbols:\n      - key: BTC\n        bench: ${SPY}\n`);
      const status = async (tf: string, extra = "") => (await GET(new NextRequest(`http://h/api/status?key=${encodeURIComponent(BTC)}&tf=${tf}${extra}`))).json();
      const wednesday = (T0 + 2 * DAY) * 1000;
      const day = await status("D", `&with=${encodeURIComponent(SPY)}`);
      expect(day).toMatchObject({ session: "always", quotedAt: quote.fetchedAt });
      expect(day.tail).toEqual({ bar: { timestamp: wednesday, open: 102, high: 151, low: 98, close: 150, volume: 7, bench: 410 }, refs: { [SPY]: { o: 410, h: 410, l: 410, c: 410, v: 1 } }, lastDay: wednesday });
      // the week and the month so far: Monday's open, the range of all three days, the quote's close
      const week = { open: 100, high: 151, low: 98, close: 150, volume: 9, bench: 410 };
      expect((await status("W")).tail).toMatchObject({ bar: { timestamp: T0 * 1000, ...week }, lastDay: wednesday });
      expect((await status("M")).tail).toMatchObject({ bar: { timestamp: Date.UTC(2026, 0, 1), ...week }, lastDay: wednesday });
      expect((await status("Q")).tail).toMatchObject({ bar: { timestamp: Date.UTC(2026, 0, 1), ...week }, lastDay: wednesday });
      expect((await GET(new NextRequest("http://h/api/status?key=nope"))).status).toBe(400);
    });

    it("the overview takes the price from any quote newer than the sync, the session only while it is current", async () => {
      const { quoteRound, liveStats } = await import("@/lib/quotes");
      const { getSymbol, readAllStats, writeBars, writeQuotes } = await import("@/lib/store");
      const GOLD = "tv:TVC:GOLD";
      writeBars(BTC, closes(100, 101), "replace");
      writeBars(SPY, closes(400, 410), "replace");
      writeBars(GOLD, closes(4000, 4100), "replace");
      const vaults = vaultsWith([{ key: "BTC", cond: "greater", value: 1000 }]);
      await quoteRound(Date.now(), vaults);
      const { getDb } = await import("@/lib/db");
      getDb().prepare("UPDATE symbols SET synced_at = ? WHERE key = ?").run(Date.now() - 3 * 3600_000, SPY);
      const day = Math.floor(Date.now() / 1000);
      const twoHoursAgo = Date.now() - 2 * 3600_000;
      // SPY's quote is two hours old: still the price (as on the chart and in alerts), but no session
      writeQuotes([
        { key: SPY, price: 500, time: day - 7200, session: "post", fetchedAt: twoHoursAgo },
        // older than GOLD's daily sync: the synced bar wins
        { key: GOLD, price: 5000, time: day, session: "closed", fetchedAt: getSymbol(GOLD)!.syncedAt! - 1000 },
      ]);
      const live = liveStats([BTC, SPY, GOLD, "yahoo:QQQ"], vaults[0].config);
      expect(Object.keys(live).sort()).toEqual([BTC, SPY].sort());
      expect(live[BTC].status.session).toBe("always");
      expect(live[BTC].stats.last).toBe(105);
      expect(live[BTC].stats.changes["1W"]).toBeCloseTo(105 / 101 - 1);
      expect(live[SPY].status).toMatchObject({ session: null, quotedAt: twoHoursAgo });
      expect(live[SPY].stats.last).toBe(500);
      expect(readAllStats("")[BTC]?.last).not.toBe(105);
    });

    it("the overview leaves a quote for a day before the last bar alone: no tag, the daily close", async () => {
      const { liveReader, liveStats } = await import("@/lib/quotes");
      const { writeBars, writeQuotes } = await import("@/lib/store");
      const { getDb } = await import("@/lib/db");
      // the last bar is Tuesday Jan 6; after the sync a fresh quote for Monday comes in
      writeBars(SPY, closes(110, 120), "replace");
      getDb().prepare("UPDATE symbols SET synced_at = ? WHERE key = ?").run(Date.now() - 60_000, SPY);
      writeQuotes([{ key: SPY, price: 115, time: T0 + 15 * 3600, session: "open", fetchedAt: Date.now() }]);
      const cfg = normalizeConfig({});
      expect(liveStats([SPY], cfg)).toEqual({});
      expect(liveReader()(SPY).at(-1)?.c).toBe(120);
    });

    it("an unfinished weekly bar closes at each symbol's own latest price; a daily one aligns to the main symbol's days", async () => {
      const { writeBars, writeQuotes } = await import("@/lib/store");
      const { NextRequest } = await import("next/server");
      const { GET } = await import("@/app/api/bars/route");
      // SPY stops on Tuesday Jan 6; BTC has Monday, Tuesday and a quote on Wednesday
      writeBars(SPY, closes(400, 410), "replace");
      writeBars(BTC, closes(100, 101), "replace");
      writeQuotes([{ key: BTC, price: 150, time: T0 + 2 * DAY + 3600, session: "always", fetchedAt: Date.now() }]);
      vaultsWith([]);
      fs.appendFileSync(path.join(root, "hebi8.yaml"), `groups:\n  - symbols:\n      - key: ${SPY}\n        bench: BTC\n`);
      const last = async (tf: string) => (await (await GET(new NextRequest(`http://h/api/bars?key=${encodeURIComponent(SPY)}&tf=${tf}`))).json()).bars.at(-1);
      expect(await last("D")).toMatchObject({ close: 410, bench: 101 });
      expect(await last("W")).toMatchObject({ close: 410, bench: 150 });
      expect(await last("M")).toMatchObject({ close: 410, bench: 150 });
    });
  });
});
