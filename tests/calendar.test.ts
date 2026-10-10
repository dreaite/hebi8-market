import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const tv = vi.hoisted(() => ({ fetchCalendar: vi.fn() }));
vi.mock("@/lib/sources/tradingview", () => ({ fetchCalendar: tv.fetchCalendar }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-calendar-"));

beforeAll(() => {
  process.env.HEBI8_DB = path.join(dir, "hebi8.db");
});

afterAll(() => {
  delete process.env.HEBI8_DB;
  fs.rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.useRealTimers();
  tv.fetchCalendar.mockReset();
});

const US = { hours: "0930-1600", holidays: "20261126,20261225", corrections: "0930-1300:20261127,20261224" };

describe("a Yahoo symbol's calendar comes from its exchange on TradingView", () => {
  it("asks one symbol per exchange family, once for a few hours", async () => {
    const { exchangeCalendar } = await import("@/lib/sources/calendar");
    vi.useFakeTimers({ toFake: ["Date"] });
    tv.fetchCalendar.mockResolvedValue(US);
    // Nasdaq, NYSE, Arca and the S&P index feed keep the same days
    for (const code of ["NMS", "NYQ", "PCX", "SNP"]) expect(await exchangeCalendar(code)).toEqual({ holidays: US.holidays, corrections: US.corrections });
    expect(tv.fetchCalendar.mock.calls).toEqual([["NASDAQ:AAPL"]]);
    // another exchange, another symbol
    await exchangeCalendar("HKG");
    expect(tv.fetchCalendar).toHaveBeenLastCalledWith("HKEX:700");
    // the next day's sync reads it again, so a new year's holidays arrive when TradingView has them
    vi.setSystemTime(Date.now() + 7 * 3600_000);
    await exchangeCalendar("NGM");
    expect(tv.fetchCalendar).toHaveBeenCalledTimes(3);
  });

  it("has none for what is no exchange with a calendar: currencies, crypto, futures, anything unknown", async () => {
    const { exchangeCalendar } = await import("@/lib/sources/calendar");
    for (const code of ["CCY", "CCC", "CME", "XXX", undefined]) expect(await exchangeCalendar(code)).toBeNull();
    expect(tv.fetchCalendar).not.toHaveBeenCalled();
  });

  it("goes without when TradingView cannot be reached, and asks again later instead of with every symbol", async () => {
    const { exchangeCalendar } = await import("@/lib/sources/calendar");
    vi.useFakeTimers({ toFake: ["Date"] });
    tv.fetchCalendar.mockRejectedValue(new Error("TradingView timeout: LSE:VOD"));
    expect(await exchangeCalendar("LSE")).toBeNull();
    expect(await exchangeCalendar("LSE")).toBeNull();
    expect(tv.fetchCalendar).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 7 * 3600_000);
    tv.fetchCalendar.mockResolvedValue(US);
    expect(await exchangeCalendar("LSE")).toEqual({ holidays: US.holidays, corrections: US.corrections });
  });
});

describe("the calendar in the cache", () => {
  it("is stored with a sync, kept when a later one brings none, and replaced by an empty one", async () => {
    const { calendarOfRow, ensureSymbol, getSymbol, markSynced } = await import("@/lib/store");
    const key = "yahoo:NVDA";
    ensureSymbol(key);
    // a symbol nobody has synced since the columns exist: nothing known
    expect(calendarOfRow(getSymbol(key))).toEqual({ hours: null, timezone: null, holidays: null, corrections: null });
    markSynced(key, { timezone: "America/New_York", ...US });
    expect(calendarOfRow(getSymbol(key))).toEqual({ timezone: "America/New_York", ...US });
    // TradingView did not answer this time
    markSynced(key, { timezone: "America/New_York", hours: "0930-1600" });
    expect(getSymbol(key)).toMatchObject({ holidays: US.holidays, corrections: US.corrections });
    // it answered: no half days any more
    markSynced(key, { holidays: US.holidays, corrections: "" });
    expect(getSymbol(key)).toMatchObject({ holidays: US.holidays, corrections: "" });
    expect(calendarOfRow(null)).toEqual({ hours: null, timezone: null, holidays: null, corrections: null });
  });
});
