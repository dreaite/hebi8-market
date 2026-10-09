import { describe, expect, it } from "vitest";
import {
  analyzeExpression,
  canonicalKey,
  directKey,
  filterTv,
  filterYahoo,
  groupLabel,
  isExpression,
  localSearch,
  looksLikeYield,
  mergeResults,
  needsTv,
  rankExternal,
  resolveOperand,
  sameSpread,
  suggestGroup,
  type SearchContext,
} from "@/lib/search";
import { displayName } from "@/lib/wellknown";

const ctx: SearchContext = {
  watchlist: [
    { key: "binance:BTCUSDT", name: "比特币", ticker: "BTCUSDT", group: "加密" },
    { key: "yahoo:QQQ", name: "纳指 100", ticker: "QQQ", group: "美股" },
    { key: "yahoo:NVDA", name: "英伟达", ticker: "NVDA", group: "美股" },
    { key: "yahoo:0700.HK", name: "腾讯控股", ticker: "0700.HK", group: "港 A" },
    { key: "yahoo:600519.SS", name: "贵州茅台", ticker: "600519.SS", group: "港 A" },
    { key: "tv:TVC:GOLD", name: "黄金", ticker: "TVC:GOLD", group: "宏观" },
    { key: "tv:TVC:US10Y", name: "美债 10 年", ticker: "TVC:US10Y", group: "宏观" },
    { key: "=BTC/GOLD", name: "比特币/黄金", ticker: "BTC/GOLD", group: "比价" },
  ],
  aliases: { SPY: "yahoo:SPY", QQQ: "yahoo:QQQ", BTC: "binance:BTCUSDT", GOLD: "tv:TVC:GOLD", CSI300: "tv:SSE:000300" },
  groups: ["加密", "美股", "港 A", "宏观", "比价"],
};

describe("directKey", () => {
  it("accepts keys and aliases regardless of case", () => {
    expect(directKey("qqq", ctx.aliases)).toBe("yahoo:QQQ");
    expect(directKey("Yahoo:aapl", ctx.aliases)).toBe("yahoo:AAPL");
    expect(directKey("tv:tvc:dxy", ctx.aliases)).toBe("tv:TVC:DXY");
    expect(directKey("=BTC/GOLD", ctx.aliases)).toBe("=BTC/GOLD");
  });
  it("rejects free text and unknown sources", () => {
    expect(directKey("apple", ctx.aliases)).toBeNull();
    expect(directKey("TVC:GOLD", ctx.aliases)).toBeNull();
    expect(directKey("", ctx.aliases)).toBeNull();
  });
});

describe("localSearch", () => {
  const keys = (q: string) => localSearch(q, ctx).map((r) => `${r.source}:${r.key}`);

  it("finds watched symbols by Chinese name, code, alias and pinyin", () => {
    expect(keys("腾讯")[0]).toBe("watchlist:yahoo:0700.HK");
    expect(keys("nvda")[0]).toBe("watchlist:yahoo:NVDA");
    expect(keys("700")[0]).toBe("watchlist:yahoo:0700.HK");
    expect(keys("tx")[0]).toBe("watchlist:yahoo:0700.HK");
    expect(keys("maotai")[0]).toBe("watchlist:yahoo:600519.SS");
    expect(keys("英伟达")[0]).toBe("watchlist:yahoo:NVDA");
  });

  it("puts the typed key or alias first, flagged as a direct key", () => {
    const rows = localSearch("qqq", ctx);
    expect(rows[0]).toMatchObject({ key: "yahoo:QQQ", source: "key", inWatchlist: "美股" });
    expect(rows.filter((r) => r.key === "yahoo:QQQ")).toHaveLength(1);
    expect(localSearch("yahoo:TSM", ctx)[0]).toMatchObject({ key: "yahoo:TSM", source: "key", name: "台积电", suggestedGroup: "美股" });
  });

  it("matches group names", () => {
    const rows = localSearch("宏观", ctx);
    expect(rows.map((r) => r.key)).toEqual(["tv:TVC:GOLD", "tv:TVC:US10Y"]);
  });

  it("offers aliases and dictionary entries that are not watched yet", () => {
    expect(keys("sol")[0]).toBe("wellknown:binance:SOLUSDT");
    expect(keys("spy")[0]).toBe("key:yahoo:SPY");
    expect(keys("csi")).toContain("alias:tv:SSE:000300");
    expect(keys("csi300")[0]).toBe("key:tv:SSE:000300");
    expect(keys("美元")).toContain("wellknown:tv:TVC:DXY");
    expect(keys("pingguo")[0]).toBe("wellknown:yahoo:AAPL");
  });

  it("ranks exact codes above prefixes and prefixes above substrings", () => {
    const rows = localSearch("eth", ctx).map((r) => r.key);
    expect(rows[0]).toBe("binance:ETHUSDT");
    expect(localSearch("btc", ctx)[0]).toMatchObject({ key: "binance:BTCUSDT", source: "key" });
  });

  it("returns nothing for an empty query", () => {
    expect(localSearch("  ", ctx)).toEqual([]);
  });
});

describe("group inference", () => {
  it("labels by key and kind", () => {
    expect(groupLabel("binance:SOLUSDT")).toBe("加密");
    expect(groupLabel("yahoo:BTC-USD", "cryptocurrency")).toBe("加密");
    expect(groupLabel("yahoo:3690.HK")).toBe("港 A");
    expect(groupLabel("yahoo:300750.SZ")).toBe("港 A");
    expect(groupLabel("tv:SSE:000300", "index")).toBe("港 A");
    expect(groupLabel("tv:TVC:GOLD", "cfd")).toBe("宏观");
    expect(groupLabel("tv:FX_IDC:USDCNH")).toBe("宏观");
    expect(groupLabel("yahoo:^GSPC", "index")).toBe("宏观");
    expect(groupLabel("yahoo:AAPL", "equity")).toBe("美股");
    expect(groupLabel("yahoo:SPY", "etf")).toBe("美股");
    expect(groupLabel("=BTC/GOLD")).toBe("比价");
  });

  it("maps labels onto the user's groups, fuzzily, falling back to the first", () => {
    expect(suggestGroup("yahoo:AAPL", "equity", ctx.groups)).toBe("美股");
    expect(suggestGroup("yahoo:3690.HK", "equity", ["币", "港股", "美国"])).toBe("港股");
    expect(suggestGroup("binance:SOLUSDT", undefined, ["币", "港股", "美国"])).toBe("币");
    expect(suggestGroup("tv:TVC:GOLD", "cfd", ["自选"])).toBe("自选");
    expect(suggestGroup("tv:TVC:GOLD", "cfd", [])).toBe("宏观");
  });
});

describe("filterYahoo", () => {
  it("drops derivatives, foreign listings and duplicate companies", () => {
    const hits = filterYahoo("apple", [
      { key: "yahoo:AAPL", name: "Apple Inc.", kind: "equity" },
      { key: "yahoo:AAPL250117C00200000", name: "AAPL Jan 2025 call", kind: "option" },
      { key: "yahoo:AAPL.MX", name: "Apple Inc.", kind: "equity" },
      { key: "yahoo:APC.F", name: "Apple Inc.", kind: "equity" },
      { key: "yahoo:APLE", name: "Apple Hospitality REIT, Inc.", kind: "equity" },
      { key: "yahoo:GC=F", name: "Gold Futures", kind: "future" },
      { key: "yahoo:VFIAX", name: "Vanguard 500 Index Fund", kind: "mutualfund" },
    ]);
    expect(hits.map((h) => h.key)).toEqual(["yahoo:AAPL", "yahoo:APLE"]);
  });

  it("keeps home-market suffixes and foreign ones the user asked for", () => {
    expect(filterYahoo("0700", [{ key: "yahoo:0700.HK", name: "Tencent", kind: "equity" }])).toHaveLength(1);
    expect(filterYahoo("shop.to", [{ key: "yahoo:SHOP.TO", name: "Shopify", kind: "equity" }])).toHaveLength(1);
  });
});

describe("filterTv / canonicalKey", () => {
  it("drops paper and moves exchange-listed stocks to Yahoo keys", () => {
    const hits = filterTv("腾讯", [
      { key: "tv:HKEX:700", name: "<em>TENCENT</em> HOLDINGS", kind: "stock" },
      { key: "tv:SSE:600519", name: "KWEICHOW MOUTAI", kind: "stock" },
      { key: "tv:NASDAQ:AAPL", name: "APPLE INC", kind: "stock" },
      { key: "tv:HKEX:TENCENT24", name: "TENCENT BOND", kind: "bond" },
      { key: "tv:SZSE:123456", name: "TENCENT STRUCTURED", kind: "structured" },
      { key: "tv:OTC:TCEHY", name: "TENCENT ADR", kind: "dr" },
      { key: "tv:BINANCE:BTCUSDT", name: "BTC/USDT", kind: "spot" },
      { key: "tv:TVC:GOLD", name: "GOLD", kind: "cfd" },
      { key: "tv:SHFE:AU1!", name: "GOLD FUTURES", kind: "futures" },
      { key: "tv:FINRA:QQQP_SHORT_VOLUME", name: "QQQP Short Sale Volume", kind: "economic" },
    ]);
    expect(hits.map((h) => `${h.key}|${h.name}`)).toEqual([
      "yahoo:0700.HK|TENCENT HOLDINGS",
      "yahoo:600519.SS|KWEICHOW MOUTAI",
      "yahoo:AAPL|APPLE INC",
      "binance:BTCUSDT|BTC/USDT",
      "tv:TVC:GOLD|GOLD",
    ]);
  });

  it("keeps bonds only for yield-like queries", () => {
    const bond = [{ key: "tv:TVC:US10Y", name: "US 10Y", kind: "bond" }];
    expect(filterTv("US10Y", bond)).toHaveLength(1);
    expect(filterTv("收益率", bond)).toHaveLength(1);
    expect(filterTv("腾讯", bond)).toHaveLength(0);
    expect(looksLikeYield("美债")).toBe(true);
    expect(looksLikeYield("gold")).toBe(false);
  });

  it("canonicalizes indices and FX to TradingView and crypto to Binance", () => {
    expect(canonicalKey("tv:SSE:000300", "index")).toBe("tv:SSE:000300");
    expect(canonicalKey("tv:NYSE:BRK.B", "stock")).toBe("yahoo:BRK-B");
    expect(canonicalKey("yahoo:BTC-USD", "cryptocurrency")).toBe("binance:BTCUSDT");
    expect(canonicalKey("tv:FX_IDC:USDCNH", "forex")).toBe("tv:FX_IDC:USDCNH");
  });
});

describe("rankExternal", () => {
  it("puts the exact Binance pair first for a coin query", () => {
    const rows = rankExternal(
      "sol",
      {
        binance: [
          { key: "binance:SOLUSDT", name: "SOLUSDT", kind: "crypto" },
          { key: "binance:SOLVUSDT", name: "SOLVUSDT", kind: "crypto" },
        ],
        yahoo: [
          { key: "yahoo:SOL-USD", name: "Solana USD", kind: "cryptocurrency" },
          { key: "yahoo:SOL", name: "ReneSola Ltd", kind: "equity" },
        ],
        tv: [],
      },
      ctx,
    );
    expect(rows[0]).toMatchObject({ key: "binance:SOLUSDT", name: "Solana", source: "binance", suggestedGroup: "加密" });
    expect(rows.map((r) => r.key)).not.toContain("yahoo:SOL-USD");
    expect(rows.map((r) => r.key)).toContain("yahoo:SOL");
  });

  it("prefers the macro instrument over a stock with the same ticker and marks watched keys", () => {
    const rows = rankExternal(
      "gold",
      {
        binance: [],
        yahoo: [
          { key: "yahoo:GOLD", name: "Barrick Gold Corporation", kind: "equity" },
          { key: "yahoo:GLD", name: "SPDR Gold Shares", kind: "etf" },
        ],
        tv: [
          { key: "tv:OANDA:XAUUSD", name: "Gold Spot / U.S. Dollar", kind: "cfd" },
          { key: "tv:TVC:GOLD", name: "CFDs on Gold (US$ / OZ)", kind: "cfd" },
        ],
      },
      ctx,
    );
    expect(rows[0]).toMatchObject({ key: "tv:TVC:GOLD", name: "黄金", inWatchlist: "宏观", suggestedGroup: "宏观" });
    expect(rows.map((r) => r.key).indexOf("yahoo:GOLD")).toBeLessThan(rows.map((r) => r.key).indexOf("tv:OANDA:XAUUSD"));
  });

  it("ranks the main listing first and names it from the dictionary", () => {
    const rows = rankExternal(
      "apple",
      {
        binance: [],
        yahoo: [
          { key: "yahoo:AAPL", name: "Apple Inc.", kind: "equity" },
          { key: "yahoo:APLE", name: "Apple Hospitality REIT", kind: "equity" },
          { key: "yahoo:AAPL=F", name: "Apple futures", kind: "future" },
        ],
        tv: [{ key: "tv:NASDAQ:AAPL", name: "APPLE INC", kind: "stock" }],
      },
      ctx,
    );
    expect(rows.map((r) => r.key)).toEqual(["yahoo:AAPL", "yahoo:APLE"]);
    expect(rows[0]).toMatchObject({ name: "苹果", suggestedGroup: "美股", source: "yahoo" });
  });

  it("merges local and external rows without repeats", () => {
    const local = localSearch("btc", ctx);
    const external = rankExternal("btc", { binance: [{ key: "binance:BTCUSDT", name: "BTCUSDT", kind: "crypto" }], yahoo: [], tv: [] }, ctx);
    const merged = mergeResults(local, external);
    expect(merged.filter((r) => r.key === "binance:BTCUSDT")).toHaveLength(1);
    expect(merged[0].source).toBe("key");
  });
});

describe("needsTv / displayName", () => {
  it("asks TradingView for CJK, exchange-qualified or thin queries", () => {
    expect(needsTv("腾讯", 0)).toBe(true);
    expect(needsTv("TVC:GOLD", 5)).toBe(true);
    expect(needsTv("apple", 5)).toBe(false);
    expect(needsTv("zzzq", 1)).toBe(true);
  });

  it("prefers the yaml name, then the dictionary, then the source", () => {
    expect(displayName("yahoo:QQQ", "纳指", "Invesco QQQ Trust")).toBe("纳指");
    expect(displayName("yahoo:QQQ", null, "Invesco QQQ Trust")).toBe("纳指 100 ETF");
    expect(displayName("tv:TVC:US02Y", null, "US 2Y")).toBe("美债 2 年");
    expect(displayName("yahoo:ZZZ", null, "Zed Corp")).toBe("Zed Corp");
    expect(displayName("yahoo:ZZZ")).toBe("ZZZ");
  });
});

describe("isExpression", () => {
  it.each(["AAPL/MSFT", "BTCUSDT/GOLD", "2*(SPY-QQQ)", "binance:BTCUSDT/tv:TVC:GOLD", "SPY - QQQ", "^GSPC/^DJI", "SPY^2", "=SPY-QQQ", "腾讯/阿里", "SPY-2"])("%j is a spread", (q) => {
    expect(isExpression(q)).toBe(true);
  });
  it.each(["AAPL", "^GSPC", "0700.HK", "BRK-B", "BTC-USD", "Berkshire B-share", "S&P 500", "data:gpu/4090-xianyu", "data:gpu/", "tv:TVC:GOLD", "苹果"])("%j is one symbol", (q) => {
    expect(isExpression(q)).toBe(false);
  });
});

describe("resolveOperand", () => {
  it("does not depend on the watchlist", () => {
    // aliases, keys and the dictionary first, whatever is watched
    expect(resolveOperand("gold", false, ctx.aliases)).toBe("tv:TVC:GOLD");
    expect(resolveOperand("Yahoo:aapl", false, ctx.aliases)).toBe("yahoo:AAPL");
    expect(resolveOperand("黄金", false, {})).toBe("tv:TVC:GOLD");
    expect(resolveOperand("BTCUSDT", false, {})).toBe("binance:BTCUSDT");
    expect(resolveOperand("eth", false, {})).toBe("binance:ETHUSDT");
    expect(resolveOperand("gspc", false, {})).toBe("yahoo:^GSPC");
    // the dictionary's pinyin initials are not codes: BP is BP, not the S&P 500 ETF
    expect(resolveOperand("BP", false, {})).toBe("yahoo:BP");
    // TradingView ids move to the preferred source
    expect(resolveOperand("NASDAQ:AAPL", false, {})).toBe("yahoo:AAPL");
    expect(resolveOperand("TVC:DXY", false, {})).toBe("tv:TVC:DXY");
    expect(resolveOperand("data:gpu", false, {})).toBeNull();
    expect(resolveOperand("yahoo:", false, {})).toBeNull();
    // the rest on its default source; NVDA is watched, which changes nothing
    expect(resolveOperand("nvda", false, ctx.aliases)).toBe("yahoo:NVDA");
    expect(resolveOperand("^n225", false, {})).toBe("yahoo:^N225");
    expect(resolveOperand("PEPEUSDT", false, {})).toBe("binance:PEPEUSDT");
    expect(resolveOperand("yahoo:BRK-B", true, {})).toBe("yahoo:BRK-B");
  });
  it("leaves names that need a search unresolved", () => {
    expect(resolveOperand("某某科技", false, {})).toBeNull();
    expect(resolveOperand("bad key", true, {})).toBeNull();
    expect(resolveOperand("=BTC/GOLD", true, {})).toBeNull();
  });
});

describe("analyzeExpression", () => {
  it("keeps the quotes of a key that is also an alias name", () => {
    expect(analyzeExpression('"yahoo:SPY"/"yahoo:QQQ"', 0, { "yahoo:SPY": "yahoo:QQQ" }).key).toBe('="yahoo:SPY"/yahoo:QQQ');
  });

  it("normalizes operands to full keys", () => {
    expect(analyzeExpression("AAPL/MSFT", 9, {}).key).toBe("=yahoo:AAPL/yahoo:MSFT");
    expect(analyzeExpression("= 2 * (SPY - QQQ)", 0, ctx.aliases).key).toBe("=2*(yahoo:SPY-yahoo:QQQ)");
    expect(analyzeExpression('btc/"yahoo:BRK-B"', 0, ctx.aliases).key).toBe('=binance:BTCUSDT/"yahoo:BRK-B"');
    expect(analyzeExpression("^GSPC/^DJI", 0, {}).key).toBe("=yahoo:^GSPC/yahoo:^DJI");
  });

  it("finds the operand at the caret, with its position in the query", () => {
    const a = analyzeExpression("=AAPL / msf", 11, {});
    expect(a.active).toEqual({ text: "msf", start: 8, end: 11, key: "yahoo:MSF" });
    expect(analyzeExpression("=AAPL / msf", 3, {}).active?.text).toBe("AAPL");
    // right after an operator there is nothing to search
    expect(analyzeExpression("AAPL/", 5, {}).active).toBeNull();
  });

  it("says what is wrong", () => {
    expect(analyzeExpression("AAPL/", 5, {}).error).toBe("表达式不完整");
    expect(analyzeExpression("(AAPL/MSFT", 0, {}).error).toBe("缺少「)」");
    expect(analyzeExpression("腾讯/AAPL", 0, {}).error).toBe("「腾讯」要从搜索结果里选一个标的");
    expect(analyzeExpression("AAPL/MSFT %", 0, {}).error).toBe("无法识别的字符「%」");
    expect(analyzeExpression("AAPL/MSFT", 0, {}).error).toBeNull();
    // checked as typed: removing the space must not turn `1 2` into `12`
    expect(analyzeExpression("AAPL/1 2", 0, {})).toMatchObject({ key: null, error: "表达式多了内容" });
    expect(analyzeExpression("SPY/1e+3 2", 0, {})).toMatchObject({ key: null, error: "表达式多了内容" });
    // an unquoted dataset key is split at `/` and `-`; its first half is no TradingView id
    expect(analyzeExpression("=data:gpu/4090-xianyu", 0, {})).toMatchObject({ key: null, error: expect.stringContaining("要加引号") });
    expect(analyzeExpression('="data:gpu/4090-xianyu"/USDCNH', 0, {}).key).toBe('="data:gpu/4090-xianyu"/tv:FX_IDC:USDCNH');
  });
});

describe("sameSpread", () => {
  it("finds a watched spread written with aliases", () => {
    const typed = analyzeExpression("btc/gold", 0, ctx.aliases).key!;
    expect(typed).toBe("=binance:BTCUSDT/tv:TVC:GOLD");
    const keys = ctx.watchlist.map((w) => w.key);
    expect(sameSpread(typed, keys, ctx.aliases)).toBe("=BTC/GOLD");
    expect(sameSpread("=BTC/GOLD", keys, ctx.aliases)).toBe("=BTC/GOLD");
    expect(sameSpread("=GOLD/BTC", keys, ctx.aliases)).toBeUndefined();
    expect(sameSpread(typed, ["binance:BTCUSDT"], ctx.aliases)).toBeUndefined();
  });
});

describe("displayName of a spread", () => {
  it("is short, like TradingView", () => {
    expect(displayName("=yahoo:AAPL/yahoo:MSFT")).toBe("AAPL/MSFT");
    expect(displayName("=BTC/GOLD")).toBe("BTC/GOLD");
  });
});
