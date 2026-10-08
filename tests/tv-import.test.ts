import { describe, expect, it } from "vitest";
import { exportTvList, keyIdentity, parseTvList, planTvImport, tvIdentity, tvSymbolOf } from "@/lib/tv-import";

describe("parseTvList", () => {
  it("reads sections from one line, as TradingView exports it", () => {
    expect(parseTvList("###美股,NASDAQ:NVDA,AMEX:SPY,###加密,BINANCE:BTCUSDT", "list")).toEqual([
      { name: "美股", symbols: ["NASDAQ:NVDA", "AMEX:SPY"] },
      { name: "加密", symbols: ["BINANCE:BTCUSDT"] },
    ]);
  });

  it("takes line breaks, blanks, a BOM and lower case", () => {
    const text = "﻿###美股,\r\nnasdaq:nvda,\n\n AMEX:SPY ,\n###加密\nBINANCE:BTCUSDT,\n";
    expect(parseTvList(text, "list")).toEqual([
      { name: "美股", symbols: ["NASDAQ:NVDA", "AMEX:SPY"] },
      { name: "加密", symbols: ["BINANCE:BTCUSDT"] },
    ]);
  });

  it("puts symbols before the first section into the fallback group", () => {
    expect(parseTvList("TVC:DXY,FX:EURUSD,###美股,NASDAQ:NVDA", "我的列表")).toEqual([
      { name: "我的列表", symbols: ["TVC:DXY", "FX:EURUSD"] },
      { name: "美股", symbols: ["NASDAQ:NVDA"] },
    ]);
    expect(parseTvList("NASDAQ:NVDA", "TradingView")).toEqual([{ name: "TradingView", symbols: ["NASDAQ:NVDA"] }]);
  });

  it("continues a section named twice and keeps repeats for the plan to flag", () => {
    expect(parseTvList("###A,X:1,###B,X:2,###A,X:3,X:1", "f")).toEqual([
      { name: "A", symbols: ["X:1", "X:3", "X:1"] },
      { name: "B", symbols: ["X:2"] },
    ]);
  });

  it("is empty for an empty file", () => {
    expect(parseTvList(" \n, ,", "f")).toEqual([]);
  });
});

describe("symbol mapping", () => {
  it("maps keys to TradingView symbols", () => {
    expect(tvSymbolOf("tv:TVC:US10Y")).toBe("TVC:US10Y");
    expect(tvSymbolOf("binance:BTCUSDT")).toBe("BINANCE:BTCUSDT");
    expect(tvSymbolOf("yahoo:0700.HK")).toBe("HKEX:700");
    expect(tvSymbolOf("yahoo:600519.SS")).toBe("SSE:600519");
    expect(tvSymbolOf("yahoo:000001.SZ")).toBe("SZSE:000001");
    expect(tvSymbolOf("yahoo:7203.T")).toBe("TSE:7203");
    expect(tvSymbolOf("yahoo:^GSPC")).toBe("SP:SPX");
    expect(tvSymbolOf("yahoo:^HSI")).toBe("HSI:HSI");
  });

  it("needs the exchange the source reported for a US ticker", () => {
    expect(tvSymbolOf("yahoo:NVDA", "NasdaqGS")).toBe("NASDAQ:NVDA");
    expect(tvSymbolOf("yahoo:KO", "NYSE")).toBe("NYSE:KO");
    expect(tvSymbolOf("yahoo:SPY", "NYSEArca")).toBe("AMEX:SPY");
    expect(tvSymbolOf("yahoo:BRK-B", "NYSE")).toBe("NYSE:BRK.B");
    expect(tvSymbolOf("yahoo:NVDA")).toBeNull();
  });

  it("has nothing for synthetic, dataset and unmapped symbols", () => {
    expect(tvSymbolOf("=BTC/GOLD")).toBeNull();
    expect(tvSymbolOf("data:gpu/4090-xianyu")).toBeNull();
    expect(tvSymbolOf("yahoo:^STOXX50E")).toBeNull();
    expect(tvSymbolOf("yahoo:EURUSD=X")).toBeNull();
    expect(tvSymbolOf("yahoo:SAP.DE", "XETRA")).toBeNull();
  });

  it("treats spellings of one listing as the same symbol", () => {
    expect(tvIdentity("NASDAQ:NVDA")).toBe(tvIdentity("BATS:NVDA"));
    expect(keyIdentity("yahoo:NVDA")).toBe(tvIdentity("NASDAQ:NVDA"));
    expect(keyIdentity("yahoo:SPY")).toBe(tvIdentity("AMEX:SPY"));
    expect(keyIdentity("yahoo:0700.HK")).toBe(tvIdentity("HKEX:0700"));
    expect(keyIdentity("yahoo:^GSPC")).toBe(tvIdentity("SP:SPX"));
    expect(keyIdentity("tv:NYSE:BRK.B")).toBe(keyIdentity("yahoo:BRK-B"));
    expect(keyIdentity("binance:BTCUSDT")).toBe(tvIdentity("BINANCE:BTCUSDT"));
    expect(keyIdentity("tv:TVC:GOLD")).toBe(tvIdentity("tvc:gold"));
    expect(keyIdentity("yahoo:NVDA")).not.toBe(tvIdentity("HKEX:NVDA"));
    expect(keyIdentity("=BTC/GOLD")).toBeNull();
  });
});

describe("planTvImport", () => {
  const watched = [
    { name: "美股", keys: ["yahoo:NVDA", "yahoo:SPY"] },
    { name: "加密", keys: ["binance:BTCUSDT"] },
  ];
  const sections = parseTvList("###美股,NASDAQ:NVDA,NASDAQ:AAPL,###新的,BINANCE:BTCUSDT,TVC:DXY,BATS:AAPL", "f");

  it("merge: adds what is not watched, flags what is and repeats", () => {
    expect(planTvImport(sections, watched, "merge")).toEqual([
      {
        name: "美股",
        existing: true,
        rows: [
          { symbol: "NASDAQ:NVDA", key: "yahoo:NVDA", status: "exists", group: "美股" },
          { symbol: "NASDAQ:AAPL", key: "tv:NASDAQ:AAPL", status: "new" },
        ],
      },
      {
        name: "新的",
        existing: false,
        rows: [
          { symbol: "BINANCE:BTCUSDT", key: "binance:BTCUSDT", status: "exists", group: "加密" },
          { symbol: "TVC:DXY", key: "tv:TVC:DXY", status: "new" },
          { symbol: "BATS:AAPL", key: "tv:BATS:AAPL", status: "duplicate", group: "美股" },
        ],
      },
    ]);
  });

  it("replace: no group counts as existing", () => {
    expect(planTvImport(sections, watched, "replace").map((g) => g.existing)).toEqual([false, false]);
  });
});

describe("exportTvList", () => {
  it("writes groups as sections and lists what it left out", () => {
    const result = exportTvList([
      {
        name: "美股",
        items: [
          { key: "yahoo:NVDA", exchange: "NasdaqGS" },
          { key: "yahoo:SPY", exchange: "NYSEArca" },
          { key: "yahoo:MSFT" },
        ],
      },
      { name: "比价", items: [{ key: "=BTC/GOLD" }] },
      { name: "宏观, 利率", items: [{ key: "tv:TVC:US10Y" }, { key: "data:gpu/4090" }, { key: "yahoo:EURUSD=X" }] },
      { name: "加密", items: [{ key: "binance:BTCUSDT" }] },
      { name: "空", items: [] },
    ]);
    expect(result.text).toBe("###美股,NASDAQ:NVDA,AMEX:SPY,###宏观  利率,TVC:US10Y,###加密,BINANCE:BTCUSDT");
    expect(result.count).toBe(4);
    expect(result.skipped).toEqual([
      { key: "yahoo:MSFT", group: "美股", reason: "交易所未知（同步一次后再导出）" },
      { key: "=BTC/GOLD", group: "比价", reason: "合成标的" },
      { key: "data:gpu/4090", group: "宏观, 利率", reason: "数据集标的" },
      { key: "yahoo:EURUSD=X", group: "宏观, 利率", reason: "没有对应的 TradingView 代码" },
    ]);
  });

  it("round-trips through the parser", () => {
    const { text } = exportTvList([{ name: "港 A", items: [{ key: "yahoo:0700.HK" }, { key: "yahoo:600519.SS" }] }]);
    expect(parseTvList(text, "f")).toEqual([{ name: "港 A", symbols: ["HKEX:700", "SSE:600519"] }]);
  });
});
