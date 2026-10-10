import { afterEach, describe, expect, it, vi } from "vitest";

// A TradingView client whose websocket is still connecting: like the library, end() does nothing then.
const fake = vi.hoisted(() => {
  const clients: { open: boolean; ended: number; connected: (() => void)[] }[] = [];
  class Client {
    state = { open: false, ended: 0, connected: [] as (() => void)[] };
    constructor() {
      clients.push(this.state);
    }
    get isOpen() {
      return this.state.open;
    }
    onConnected(cb: () => void) {
      this.state.connected.push(cb);
    }
    async end() {
      if (this.state.open) this.state.open = false;
      this.state.ended++;
    }
    Session = {
      Quote: class {
        Market = class {
          onData() {}
          onLoaded() {}
          onError() {}
        };
        delete() {}
      },
    };
  }
  return { clients, Client };
});
vi.mock("@mathieuc/tradingview", () => ({ default: { Client: fake.Client } }));

afterEach(() => vi.useRealTimers());

describe("TradingView quotes", () => {
  it("closes a connection whose handshake outlived the timeout as soon as it connects", async () => {
    vi.useFakeTimers();
    const { tradingview } = await import("@/lib/sources/tradingview");
    const result = tradingview.quotes!(["TVC:GOLD"]);
    const failed = expect(result).rejects.toThrow("no data");
    await vi.advanceTimersByTimeAsync(20_000);
    await failed;
    const [client] = fake.clients;
    expect(client.ended).toBe(1);
    expect(client.connected).toHaveLength(1);
    // the socket finally opens: it is closed right away instead of lingering
    client.open = true;
    client.connected.forEach((cb) => cb());
    expect(client.ended).toBe(2);
    expect(client.open).toBe(false);
  });

  it("keeps the calendar of the symbol info from last year on: hours, holidays, the regular session's corrections", async () => {
    const { calendarOf } = await import("@/lib/sources/tradingview");
    const now = Date.UTC(2026, 9, 10);
    // NASDAQ:AAPL as its symbol info read on 2026-10-10 (the lists shortened in the middle)
    const infos = {
      session: "0930-1600",
      subsession_id: "regular",
      session_holidays: "20000117,20241225,20250101,20251225,20260101,20261126,20261225,20270101,20271224",
      subsessions: [
        { id: "premarket", session: "0400-0930", "session-correction": "0400-0930:20261127" },
        { id: "regular", session: "0930-1600", "session-correction": "0930-1300:20190703,20241224,20250703,20251128,20251224,20261127,20261224,20271126,20271223;dayoff:20250109" },
      ],
    };
    expect(calendarOf(infos, now)).toEqual({
      hours: "0930-1600",
      holidays: "20250101,20251225,20260101,20261126,20261225,20270101,20271224",
      corrections: "0930-1300:20250703,20251128,20251224,20261127,20261224,20271126,20271223;dayoff:20250109",
    });
    // an entry with only old dates goes; so does everything when the info has no lists
    expect(calendarOf({ ...infos, subsessions: [{ id: "regular", "session-correction": "1900-1300:20241224;1700F2-1200F1,1700-1215:20251128,20261127" }] }, now).corrections).toBe("1700F2-1200F1,1700-1215:20251128,20261127");
    expect(calendarOf({ session: "24x7" }, now)).toEqual({ hours: "24x7", holidays: "", corrections: "" });
    // Brent's hours come with every summer-time switch since 2007: the versions that ended before last year go
    const brent = "0100-2300|2300F-2300:2#20070312/0000-2200|2200F-2200:2#20241104/0100-2300|2300F-2300:2#20250310/0000-2200|2200F-2200:2#20261026/0100-2300|2300F-2300:2";
    expect(calendarOf({ session: brent }, now).hours).toBe("0100-2300|2300F-2300:2#20250310/0000-2200|2200F-2200:2#20261026/0100-2300|2300F-2300:2");
  });
});
