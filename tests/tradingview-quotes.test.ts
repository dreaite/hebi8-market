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
});
