import { describe, expect, it } from "vitest";
import { barCloseAt, fmtCountdown, sessionEnd, type SessionClock } from "@/lib/session";

const utc = (s: string) => Date.parse(`${s}Z`);
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString().slice(0, 16));

describe("the countdown to the bar's close", () => {
  it("around the clock, bars end with the UTC day, the week on Monday, the month and the quarter", () => {
    const crypto: SessionClock = { session: "always", quotedAt: null, hours: "24x7", timezone: "UTC" };
    const now = utc("2026-10-07T13:20:00"); // a Wednesday
    expect(iso(barCloseAt("D", now, crypto))).toBe("2026-10-08T00:00");
    expect(iso(barCloseAt("W", now, crypto))).toBe("2026-10-12T00:00");
    expect(iso(barCloseAt("M", now, crypto))).toBe("2026-11-01T00:00");
    expect(iso(barCloseAt("Q", now, crypto))).toBe("2027-01-01T00:00");
    // TradingView's 24x7 symbols report an ordinary open session
    expect(iso(barCloseAt("D", now, { session: "open", quotedAt: now, hours: "24x7", timezone: "Etc/UTC" }))).toBe("2026-10-08T00:00");
  });

  it("an exchange's bar ends at its close: today, on Friday, on the last weekday of the month or quarter", () => {
    const now = utc("2026-10-07T15:00:00"); // Wednesday 11:00 in New York
    const nyse: SessionClock = { session: "open", quotedAt: now - 120_000, hours: "0930-1600", timezone: "America/New_York" };
    expect(iso(barCloseAt("D", now, nyse))).toBe("2026-10-07T20:00");
    expect(iso(barCloseAt("W", now, nyse))).toBe("2026-10-09T20:00");
    expect(iso(barCloseAt("M", now, nyse))).toBe("2026-10-30T20:00"); // Oct 31 is a Saturday
    // winter time by then: 16:00 in New York is 21:00 UTC
    expect(iso(barCloseAt("Q", now, nyse))).toBe("2026-12-31T21:00");
    // a lunch break: the last session closes the day
    const sse: SessionClock = { session: "open", quotedAt: utc("2026-10-09T02:00:00"), hours: "0930-1130,1300-1500", timezone: "Asia/Shanghai" };
    expect(iso(barCloseAt("D", utc("2026-10-09T02:01:00"), sse))).toBe("2026-10-09T07:00");
  });

  it("an overnight session closes on the trading day it belongs to", () => {
    // Sunday 18:30 in Chicago: Monday's session of a future that trades 17:00 to 16:00
    const now = utc("2026-10-04T23:30:00");
    const cme: SessionClock = { session: "open", quotedAt: now, hours: "1700-1600", timezone: "America/Chicago" };
    expect(iso(barCloseAt("D", now, cme))).toBe("2026-10-05T21:00");
    expect(iso(barCloseAt("W", now, cme))).toBe("2026-10-09T21:00");
  });

  it("shows nothing outside the regular session, without a current quote, without hours, or once the close has passed", () => {
    const now = utc("2026-10-07T15:00:00");
    const nyse: SessionClock = { session: "open", quotedAt: now, hours: "0930-1600", timezone: "America/New_York" };
    for (const session of ["pre", "post", "closed", null] as const) expect(barCloseAt("D", now, { ...nyse, session })).toBeNull();
    expect(barCloseAt("D", now, { ...nyse, hours: null })).toBeNull();
    expect(barCloseAt("D", now, { ...nyse, timezone: null })).toBeNull();
    // the last quote said open at 15:58; at 16:01 the bar is done, not counting to tomorrow's close
    expect(barCloseAt("D", utc("2026-10-07T20:01:00"), { ...nyse, quotedAt: utc("2026-10-07T19:58:00") })).toBeNull();
  });

  it("reads the closing time of TradingView's session strings", () => {
    expect(sessionEnd("0930-1600")).toEqual({ hh: 16, mm: 0 });
    expect(sessionEnd("1700-1600:23456|1700-1500:6")).toEqual({ hh: 16, mm: 0 });
    expect(sessionEnd("0930-1130,1300-1500")).toEqual({ hh: 15, mm: 0 });
    expect(sessionEnd("0930-1130E0925-1131S1300-1500E1300-1501")).toEqual({ hh: 15, mm: 0 });
    expect(sessionEnd("1900-1900:3456|1700F-1900:2")).toEqual({ hh: 19, mm: 0 });
    expect(sessionEnd("24x7")).toBeNull();
  });

  it("formats like TradingView", () => {
    expect(fmtCountdown(9 * 1000)).toBe("00:09");
    expect(fmtCountdown((12 * 60 + 9) * 1000)).toBe("12:09");
    expect(fmtCountdown((5 * 3600 + 12 * 60 + 9) * 1000 + 999)).toBe("05:12:09");
    expect(fmtCountdown((2 * 86400 + 5 * 3600 + 59 * 60) * 1000)).toBe("2d 5h");
  });
});
