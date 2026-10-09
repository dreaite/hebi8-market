import { afterEach, describe, expect, it, vi } from "vitest";
import { PUBLIC_URL, publicUrl } from "@/lib/app-info";
import { bareUrl } from "@/lib/brand";
import { chartTitle, decodeChartKey } from "@/lib/symbols";

afterEach(() => vi.unstubAllEnvs());

describe("the public address", () => {
  it("defaults to the tunnel and takes HEBI8_PUBLIC_URL when it is an http(s) URL", () => {
    vi.stubEnv("HEBI8_PUBLIC_URL", "");
    expect(publicUrl()).toBe(PUBLIC_URL);
    vi.stubEnv("HEBI8_PUBLIC_URL", "https://market.example.org/");
    expect(publicUrl()).toBe("https://market.example.org");
    vi.stubEnv("HEBI8_PUBLIC_URL", "market.example.org");
    expect(publicUrl()).toBe(PUBLIC_URL);
  });

  it("prints under a chart without the scheme and with the key readable", () => {
    expect(bareUrl(`${PUBLIC_URL}/chart/${encodeURIComponent("=BTC/GOLD")}`)).toBe("market-hebi8.dreaife.tokyo/chart/=BTC/GOLD");
  });
});

describe("what a shared chart is called", () => {
  it("name, ticker and timeframe; the ticker once when there is no other name", () => {
    expect(chartTitle("英伟达", "NVDA", "W")).toBe("英伟达 NVDA · 周线");
    expect(chartTitle("BTCUSDT", "BTCUSDT", "D")).toBe("BTCUSDT · 日线");
  });

  it("decodes keys from links, and leaves a broken escape alone", () => {
    expect(decodeChartKey("yahoo%3ANVDA")).toBe("yahoo:NVDA");
    expect(decodeChartKey("%3DBTC%2FGOLD")).toBe("=BTC/GOLD");
    expect(decodeChartKey("yahoo:NVDA")).toBe("yahoo:NVDA");
    expect(decodeChartKey("%E0%A4%A")).toBe("%E0%A4%A");
  });
});
