import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const token = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));
vi.mock("@mathieuc/tradingview", () => ({
  default: {
    getChartToken: async (...args: unknown[]) => {
      token.calls.push(args);
      if (token.fail) throw new Error("Wrong layout or credentials");
      return "JWT";
    },
  },
}));

const COOKIE = "sessionid=SESS;sessionid_sign=SIGN";
const MARKETS = `<script>var is_authenticated = true;\nvar user = {"id":64613541,"username":"someone","broker":{"user":{"username":"FOREXcom","id":1}}};</script>`;

const source = (id: string, symbol: string) => ({
  id,
  symbol,
  ownerSource: "_seriesId",
  state: { type: "LineToolHorzLine", id, points: [{ time_t: 1745328600, offset: 0, price: 1, interval: "240" }], state: { linecolor: "#2962FF", interval: "240" } },
});

const SIZES = {
  layout: {
    charts: {
      _shared: { countSourcesChart: 3, symbols: { "AMEX:GLD": { countSources: 2, ids: ["a", "b"] }, "1/FX:USDJPY*TVC:DXY": { countSources: 1, ids: ["x"] } } },
      "2": { countSourcesChart: 1, symbols: { "AMEX:GLD": { countSources: 1, ids: ["a"] } } },
    },
  },
  user: { charts: { UserSync: { countSourcesChart: 1, symbols: { "BINANCE:BTCUSDT": { countSources: 1, ids: ["u"] } } } } },
};
const SOURCES: Record<string, Record<string, unknown>> = {
  "layout:_shared:AMEX:GLD": { a: source("a", "AMEX:GLD"), b: source("b", "AMEX:GLD") },
  "layout:_shared:1/FX:USDJPY*TVC:DXY": { x: source("x", "1/FX:USDJPY*TVC:DXY") },
  "layout:2:AMEX:GLD": { a: source("a", "AMEX:GLD") },
  "user::BINANCE:BTCUSDT": { u: source("u", "BINANCE:BTCUSDT") },
};

let requests: { url: URL; init: RequestInit }[] = [];
let markets: () => Response = () => new Response(MARKETS, { status: 200 });

beforeEach(() => {
  requests = [];
  token.calls = [];
  token.fail = false;
  markets = () => new Response(MARKETS, { status: 200 });
  vi.stubGlobal("fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    requests.push({ url, init });
    if (url.href === "https://www.tradingview.com/markets/") return markets();
    const json = (payload: unknown) => new Response(JSON.stringify({ success: true, payload }), { status: 200 });
    const p = url.pathname.replace("/charts-storage/", "");
    if (p === "layout/L1/sizes") return json(SIZES.layout);
    if (p === "user/sizes") return json(SIZES.user);
    const symbol = url.searchParams.get("symbol")!;
    if (p === "get/layout/L1/sources") return json({ sources: SOURCES[`layout:${url.searchParams.get("chart_id")}:${symbol}`] });
    if (p === "get/user/sources") return json({ sources: SOURCES[`user::${symbol}`] });
    return new Response("", { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("fetchLayoutDrawings", () => {
  it("lists what is stored where, then fetches each symbol with the cookies, the token and the layout id", async () => {
    const { fetchLayoutDrawings } = await import("@/lib/tv-layout");
    const result = await fetchLayoutDrawings("L1", "SESS", "SIGN");
    expect(token.calls).toEqual([["L1", { id: "64613541", session: "SESS", signature: "SIGN" }]]);
    expect(result.drawings.map((d) => [d.id, d.symbol, d.type])).toEqual([
      ["a", "AMEX:GLD", "LineToolHorzLine"],
      ["b", "AMEX:GLD", "LineToolHorzLine"],
      ["x", "1/FX:USDJPY*TVC:DXY", "LineToolHorzLine"],
      ["u", "BINANCE:BTCUSDT", "LineToolHorzLine"],
    ]);
    // the counts match the size listings; the drawing in two charts is imported once
    // (a numeric chart id comes first: that is how JavaScript orders object keys)
    expect(result.origins).toEqual([
      { source: "layout", chartId: "2", count: 1, expected: 1 },
      { source: "layout", chartId: "_shared", count: 3, expected: 3 },
      { source: "user", chartId: "UserSync", count: 1, expected: 1 },
    ]);
    const storage = requests.filter((r) => r.url.hostname === "charts-storage.tradingview.com");
    expect(storage).toHaveLength(6);
    for (const r of storage) {
      expect((r.init.headers as Record<string, string>).cookie).toBe(COOKIE);
      expect(r.url.searchParams.get("layout_id")).toBe("L1");
      expect(r.url.searchParams.get("jwt")).toBe("JWT");
    }
    const user = storage.find((r) => r.url.pathname.endsWith("get/user/sources"))!;
    expect(user.url.searchParams.has("chart_id")).toBe(false);
    expect(user.url.searchParams.get("symbol")).toBe("BINANCE:BTCUSDT");
  });

  it("reads the account from the markets page without following redirects", async () => {
    const { fetchLayoutDrawings } = await import("@/lib/tv-layout");
    await fetchLayoutDrawings("L1", "SESS", "SIGN");
    const page = requests[0];
    expect(page.url.href).toBe("https://www.tradingview.com/markets/");
    expect(page.init.redirect).toBe("manual");
    expect((page.init.headers as Record<string, string>).cookie).toBe(COOKIE);

    markets = () => new Response("", { status: 302, headers: { location: "https://cn.tradingview.com/markets/" } });
    await expect(fetchLayoutDrawings("L1", "SESS", "SIGN")).rejects.toThrow("连不上 tradingview.com 取账号信息（HTTP 302）");
    markets = () => new Response("<script>var is_authenticated = false;</script>", { status: 200 });
    await expect(fetchLayoutDrawings("L1", "SESS", "SIGN")).rejects.toThrow("TradingView 不认这组 sessionid / sessionid_sign（不对或已过期）");
  });

  it("says when the layout is not there, and never puts the cookies in an error", async () => {
    const { fetchLayoutDrawings } = await import("@/lib/tv-layout");
    token.fail = true;
    const err = await fetchLayoutDrawings("L1", "SESS", "SIGN").catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("取不到布局 L1：布局不存在，或这个账号打不开它");
    expect((err as Error).message).not.toMatch(/SESS|SIGN/);
  });
});
