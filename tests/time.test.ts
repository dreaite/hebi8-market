import { describe, expect, it } from "vitest";
import { tradingDay } from "@/lib/time";

const utc = (iso: string) => Date.parse(iso) / 1000;
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

// Timestamps as TradingView/Yahoo actually report them for daily bars.
describe("tradingDay", () => {
  it("US stocks stamped at the open", () => {
    expect(date(tradingDay(utc("2026-10-05T13:30:00Z"), "America/New_York"))).toBe("2026-10-05");
  });

  it("Asian exchanges stamped at 01:30 UTC", () => {
    expect(date(tradingDay(utc("2026-10-05T01:30:00Z"), "Asia/Hong_Kong"))).toBe("2026-10-05");
    expect(date(tradingDay(utc("2026-09-30T01:30:00Z"), "Asia/Shanghai"))).toBe("2026-09-30");
  });

  it("FX sessions that open on the previous evening", () => {
    // FX_IDC: Monday's bar starts Sunday 22:00 UTC
    expect(date(tradingDay(utc("2026-10-04T22:00:00Z"), "Etc/UTC"))).toBe("2026-10-05");
  });

  it("TVC futures in New York time, summer and winter", () => {
    // 19:00 EDT Sunday = 23:00 UTC; 19:00 EST Sunday = 00:00 UTC Monday
    expect(date(tradingDay(utc("2026-10-04T23:00:00Z"), "America/New_York"))).toBe("2026-10-05");
    expect(date(tradingDay(utc("2026-01-05T00:00:00Z"), "America/New_York"))).toBe("2026-01-05");
  });

  it("crypto bars at 00:00 UTC", () => {
    expect(date(tradingDay(utc("2026-10-05T00:00:00Z")))).toBe("2026-10-05");
  });

  it("falls back to UTC for an unknown timezone", () => {
    expect(date(tradingDay(utc("2026-10-05T00:00:00Z"), "Not/AZone"))).toBe("2026-10-05");
  });
});
