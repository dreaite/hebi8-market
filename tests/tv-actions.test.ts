import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const synced = vi.hoisted(() => ({ all: 0, one: [] as string[], fail: "" }));
vi.mock("@/lib/sync", async (original) => ({
  ...(await original<typeof import("@/lib/sync")>()),
  syncAll: async () => {
    synced.all++;
    return [];
  },
  syncOne: async (key: string) => {
    synced.one.push(key);
    return key === synced.fail ? { key, ok: false, error: "not found" } : { key, ok: true };
  },
}));

const YAML = `# 我的自选
aliases:
  BTC: binance:BTCUSDT # 比特币
groups:
  - name: 美股 # 先看美股
    symbols:
      - { key: yahoo:NVDA, name: 英伟达, bench: yahoo:QQQ } # 核心
      - yahoo:SPY
  - name: 加密
    symbols: [BTC]
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-tv-"));
const root = path.join(dir, "vault");
const yamlFile = path.join(root, "hebi8.yaml");
const read = () => fs.readFileSync(yamlFile, "utf8");

const DAY = 86400;
const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;

beforeAll(async () => {
  process.env.HEBI8_VAULT = root;
  process.env.HEBI8_DB = path.join(dir, "hebi8.db");
  process.env.HEBI8_SECRETS = path.join(dir, "secrets");
  fs.mkdirSync(root);
  // NVDA's bars: the weekdays of Sep 2026, stored at UTC midnight
  const { ensureSymbol, markSynced, writeBars } = await import("@/lib/store");
  const bars = [];
  for (let t = day("2026-09-01"); t <= day("2026-09-30"); t += DAY) {
    const wd = new Date(t * 1000).getUTCDay();
    if (wd !== 0 && wd !== 6 && t !== day("2026-09-07")) bars.push({ t, o: 100, h: 110, l: 90, c: 105, v: 1, adj: 1 });
  }
  ensureSymbol("yahoo:NVDA");
  writeBars("yahoo:NVDA", bars, "replace");
  markSynced("yahoo:NVDA", { timezone: "America/New_York", exchange: "NasdaqGS" });
});

afterAll(() => {
  delete process.env.HEBI8_VAULT;
  delete process.env.HEBI8_DB;
  delete process.env.HEBI8_SECRETS;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.writeFileSync(yamlFile, YAML);
  fs.rmSync(path.join(root, "charts"), { recursive: true, force: true });
  synced.all = 0;
  synced.one = [];
  synced.fail = "";
});

const groups = async () => {
  const { readConfig } = await import("@/lib/vault");
  return readConfig(root).groups.map((g) => `${g.name}:${g.symbols.map((s) => s.key).join(",")}`);
};

describe("importTvList", () => {
  const FILE = "###美股,NASDAQ:NVDA,NASDAQ:AAPL,###宏观,TVC:DXY,TVC:GOLD,BATS:AAPL,###加密,BINANCE:BTCUSDT";

  it("merge: adds new symbols to the same-named group or a new one at the end, keeps the rest and the comments", async () => {
    const { importTvList } = await import("@/app/tv-actions");
    expect(await importTvList({ text: FILE, fallback: "TV", mode: "merge" })).toEqual({ ok: true, added: 3, groups: 3 });
    expect(await groups()).toEqual(["美股:yahoo:NVDA,yahoo:SPY,tv:NASDAQ:AAPL", "加密:binance:BTCUSDT", "宏观:tv:TVC:DXY,tv:TVC:GOLD"]);
    expect(read()).toContain("# 先看美股");
    expect(read()).toContain("{ key: yahoo:NVDA, name: 英伟达, bench: yahoo:QQQ } # 核心");
    // the dictionary's name, as addSymbol writes it
    expect(read()).toMatch(/key: tv:TVC:GOLD, name: \S+/);
    expect(synced.all).toBe(1);
  });

  it("merge: says so when everything is already there", async () => {
    const { importTvList } = await import("@/app/tv-actions");
    expect(await importTvList({ text: "NASDAQ:NVDA,AMEX:SPY", fallback: "TV", mode: "merge" })).toEqual({ ok: false, error: "文件里的标的都已经在自选里了" });
    expect(read()).toBe(YAML);
  });

  it("replace: the groups become the file's, a watched symbol keeps its entry", async () => {
    const { importTvList } = await import("@/app/tv-actions");
    expect(await importTvList({ text: FILE, fallback: "TV", mode: "replace" })).toEqual({ ok: true, added: 3, groups: 3 });
    expect(await groups()).toEqual(["美股:yahoo:NVDA,tv:NASDAQ:AAPL", "宏观:tv:TVC:DXY,tv:TVC:GOLD", "加密:binance:BTCUSDT"]);
    expect(read()).toContain("{ key: yahoo:NVDA, name: 英伟达, bench: yahoo:QQQ } # 核心");
    expect(read()).toContain("- BTC");
    expect(read()).not.toContain("yahoo:SPY");
    expect(read()).toContain("# 我的自选");
  });
});

describe("TradingView drawings", () => {
  /** A `sources` response as the browser's developer tools show it, written by hand. */
  const t = (iso: string) => day(iso) + 13.5 * 3600;
  const source = (id: string, symbol: string, type: string, points: unknown[], state: Record<string, unknown>) => ({
    id,
    symbol,
    ownerSource: "_seriesId",
    currencyId: "USD",
    state: { type, id, points, zorder: -5000, state },
  });
  const RESPONSE = {
    success: true,
    payload: {
      sources: {
        h1: source("h1", "NASDAQ:NVDA", "LineToolHorzLine", [{ time_t: t("2026-09-08"), offset: 0, price: 120 }], { linecolor: "rgba(242, 54, 69, 1)", linewidth: 2, linestyle: 2 }),
        t1: source("t1", '={"adjustment":"splits","symbol":"NASDAQ:NVDA"}', "LineToolTrendLine", [
          { time_t: t("2026-09-01"), offset: 0, price: 95 },
          { time_t: t("2026-09-28"), offset: 4, price: 118 },
        ], { linecolor: "#2962FF", linewidth: 1, linestyle: 0, extendRight: true }),
        x1: source("x1", "NASDAQ:NVDA", "LineToolText", [{ time_t: t("2026-09-15"), offset: 0, price: 125 }], { text: "财报", color: "#FF9800", fontsize: 18 }),
        v1: source("v1", "NASDAQ:NVDA", "LineToolFixedRangeVolumeProfile", [{ time_t: t("2026-09-01"), price: 1 }, { time_t: t("2026-09-10"), price: 1 }], {}),
        d1: source("d1", "TVC:DXY", "LineToolHorzLine", [{ time_t: day("2026-09-01") + 21 * 3600, price: 101 }], { linecolor: "#089981" }),
        b1: source("b1", "BINANCE:BTCUSDT", "LineToolVertLine", [{ time_t: day("2026-09-03"), price: 60000 }], { linecolor: "#787B86" }),
      },
    },
  };

  it("previews per symbol, imports into charts/<fileKey>.json, and a second import adds nothing", async () => {
    const { parseTvSources } = await import("@/lib/tv-drawings");
    const { importTvDrawings, previewTvDrawings } = await import("@/app/tv-actions");
    const drawings = parseTvSources(JSON.stringify(RESPONSE));
    expect(drawings).toHaveLength(6);

    const preview = await previewTvDrawings({ drawings });
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.symbols).toEqual([
      { symbol: "NASDAQ:NVDA", key: "yahoo:NVDA", group: "美股", total: 4, ready: 3, already: 0, skipped: { "没有对应的工具：LineToolFixedRangeVolumeProfile": 1 } },
      { symbol: "TVC:DXY", key: null, group: null, total: 1, ready: 1, already: 0, skipped: {} },
      { symbol: "BINANCE:BTCUSDT", key: "binance:BTCUSDT", group: "加密", total: 1, ready: 1, already: 0, skipped: {} },
    ]);

    // DXY goes into a new group; the chart of an existing NVDA file keeps its drawing and comparison
    const { readChartState, writeChartState } = await import("@/lib/vault");
    const mine = { name: "segment", points: [{ timestamp: day("2026-09-02") * 1000, value: 100 }, { timestamp: day("2026-09-04") * 1000, value: 101 }] };
    writeChartState(root, "yahoo:NVDA", { compare: [{ key: "yahoo:QQQ", mode: "percent", color: "#0e9aa7" }], overlays: [mine] });
    const result = await importTvDrawings({ drawings: preview.drawings, add: { "TVC:DXY": "宏观" } });
    expect(result).toEqual({
      ok: true,
      failed: [],
      symbols: [
        { symbol: "NASDAQ:NVDA", key: "yahoo:NVDA", imported: 3, already: 0, skipped: { "没有对应的工具：LineToolFixedRangeVolumeProfile": 1 } },
        { symbol: "TVC:DXY", key: "tv:TVC:DXY", imported: 1, already: 0, skipped: {} },
        { symbol: "BINANCE:BTCUSDT", key: "binance:BTCUSDT", imported: 1, already: 0, skipped: {} },
      ],
    });
    expect(synced.one).toEqual(["tv:TVC:DXY"]);
    expect(await groups()).toEqual(["美股:yahoo:NVDA,yahoo:SPY", "加密:binance:BTCUSDT", "宏观:tv:TVC:DXY"]);

    const nvda = JSON.parse(fs.readFileSync(path.join(root, "charts", "yahoo_NVDA.json"), "utf8"));
    expect(nvda.key).toBe("yahoo:NVDA");
    expect(nvda.compare).toHaveLength(1);
    expect(nvda.tvIds).toEqual(["h1", "t1", "x1"]);
    expect(nvda.overlays.map((o: { name: string }) => o.name)).toEqual(["segment", "horizontalStraightLine", "rayLine", "text"]);
    // Sep 28 is the second last bar: 4 bars on are Sep 30 and two calendar days after it
    expect(nvda.overlays[2].points).toEqual([
      { timestamp: day("2026-09-01") * 1000, value: 95 },
      { timestamp: day("2026-10-02") * 1000, value: 118 },
    ]);
    expect(nvda.overlays[3]).toMatchObject({ extendData: "财报", styles: { line: { color: "#ff9800" }, text: { size: 18 } } });
    // the chart page reads it back like any other
    const state = readChartState(root, "yahoo:NVDA");
    expect(state.overlays).toHaveLength(4);
    expect(state.overlays[0]).toEqual(mine);
    // no timezone cached for DXY here (the real first fetch caches it): UTC, so 21:00 stays on its day
    expect(readChartState(root, "tv:TVC:DXY").overlays[0].points[0].timestamp).toBe(day("2026-09-01") * 1000);

    const again = await importTvDrawings({ drawings: preview.drawings, add: {} });
    expect(again.ok && again.symbols.map((s) => [s.imported, s.already])).toEqual([
      [0, 3],
      [0, 1],
      [0, 1],
    ]);
    expect(readChartState(root, "yahoo:NVDA").overlays).toHaveLength(4);
    const second = await previewTvDrawings({ drawings: preview.drawings });
    expect(second.ok && second.symbols[0]).toMatchObject({ ready: 0, already: 3 });
  });

  it("keeps the imported ids when the chart saves its drawings", async () => {
    const { importTvDrawings } = await import("@/app/tv-actions");
    const { saveChartState } = await import("@/app/actions");
    const { parseTvSources } = await import("@/lib/tv-drawings");
    const { readChartState } = await import("@/lib/vault");
    await importTvDrawings({ drawings: parseTvSources(JSON.stringify(RESPONSE)), add: {} });
    const state = readChartState(root, "yahoo:NVDA");
    expect(await saveChartState("yahoo:NVDA", { compare: [], overlays: state.overlays.slice(1) })).toEqual({ ok: true });
    expect(readChartState(root, "yahoo:NVDA")).toMatchObject({ overlays: state.overlays.slice(1), tvIds: ["h1", "t1", "x1"] });
  });

  it("skips unwatched symbols not chosen, and reports one whose first fetch fails", async () => {
    const { importTvDrawings } = await import("@/app/tv-actions");
    const { parseTvSources } = await import("@/lib/tv-drawings");
    synced.fail = "tv:TVC:DXY";
    const result = await importTvDrawings({ drawings: parseTvSources(JSON.stringify(RESPONSE)), add: { "TVC:DXY": "宏观" } });
    expect(result.ok && result.failed).toEqual([{ symbol: "TVC:DXY", error: "not found" }]);
    expect(result.ok && result.symbols.map((s) => s.symbol)).toEqual(["NASDAQ:NVDA", "BINANCE:BTCUSDT"]);
    expect(read()).not.toContain("DXY");
  });
});
