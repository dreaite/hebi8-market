import { describe, expect, it } from "vitest";
import { lastDue, nextRun } from "@/lib/scheduler";
import { partsIn, zonedToUtc } from "@/lib/tz";
import { currentWeekId, isoWeekId, shiftWeek, weekStart } from "@/lib/week";

const at = ["07:30", "17:30"];
const iso = (d: Date) => d.toISOString();

describe("nextRun / lastDue", () => {
  it("picks the next slot today, or the first slot tomorrow after the last one", () => {
    // 10:00 JST = 01:00 UTC
    expect(iso(nextRun(new Date("2026-10-06T01:00:00Z"), at, "Asia/Tokyo"))).toBe("2026-10-06T08:30:00.000Z");
    // 20:00 JST: next is 07:30 JST tomorrow = 22:30 UTC today
    expect(iso(nextRun(new Date("2026-10-06T11:00:00Z"), at, "Asia/Tokyo"))).toBe("2026-10-06T22:30:00.000Z");
    expect(iso(lastDue(new Date("2026-10-06T11:00:00Z"), at, "Asia/Tokyo"))).toBe("2026-10-06T08:30:00.000Z");
    // just after midnight JST: the last slot was yesterday evening
    expect(iso(lastDue(new Date("2026-10-06T15:30:00Z"), at, "Asia/Tokyo"))).toBe("2026-10-06T08:30:00.000Z");
  });

  it("follows daylight saving time", () => {
    // New York leaves DST on 2026-11-01: 07:30 EDT is 11:30 UTC, 07:30 EST is 12:30 UTC
    expect(iso(nextRun(new Date("2026-10-31T13:00:00Z"), ["07:30"], "America/New_York"))).toBe("2026-11-01T12:30:00.000Z");
    expect(iso(nextRun(new Date("2026-10-30T13:00:00Z"), ["07:30"], "America/New_York"))).toBe("2026-10-31T11:30:00.000Z");
    // the slot exactly now counts as due, not next
    expect(iso(lastDue(new Date("2026-11-01T12:30:00Z"), ["07:30"], "America/New_York"))).toBe("2026-11-01T12:30:00.000Z");
    expect(iso(nextRun(new Date("2026-11-01T12:30:00Z"), ["07:30"], "America/New_York"))).toBe("2026-11-02T12:30:00.000Z");
  });

  it("converts wall-clock times through the zone", () => {
    expect(zonedToUtc({ y: 2026, m: 3, d: 29, hh: 3, mm: 0 }, "Europe/Berlin")).toBe(Date.parse("2026-03-29T01:00:00Z"));
    expect(partsIn(new Date("2026-10-06T23:30:00Z"), "Asia/Tokyo")).toEqual({ y: 2026, m: 10, d: 7, hh: 8, mm: 30 });
  });
});

describe("iso weeks", () => {
  it("numbers weeks per ISO 8601", () => {
    expect(isoWeekId(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
    expect(isoWeekId(new Date("2026-10-06T00:00:00Z"))).toBe("2026-W41");
    expect(isoWeekId(new Date("2027-01-03T00:00:00Z"))).toBe("2026-W53");
    expect(isoWeekId(new Date("2027-01-04T00:00:00Z"))).toBe("2027-W01");
  });

  it("walks weeks from their Monday", () => {
    expect(iso(weekStart("2026-W41"))).toBe("2026-10-05T00:00:00.000Z");
    expect(shiftWeek("2026-W01", -1)).toBe("2025-W52");
    expect(shiftWeek("2026-W53", 1)).toBe("2027-W01");
  });

  it("uses the wall clock of the configured zone", () => {
    // Sunday 23:00 UTC is already Monday in Tokyo
    expect(currentWeekId("Asia/Tokyo", new Date("2026-10-04T23:00:00Z"))).toBe("2026-W41");
    expect(currentWeekId("UTC", new Date("2026-10-04T23:00:00Z"))).toBe("2026-W40");
  });
});
