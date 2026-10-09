import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fitText, fontCoverage } from "@/lib/font-coverage";

// the Latin-only font next/og ships with: what the social images fall back to without a CJK font
const latin = fontCoverage(fs.readFileSync(path.join(__dirname, "..", "node_modules/next/dist/compiled/@vercel/og/Geist-Regular.ttf")));
const everything = () => true;

describe("text for the social images", () => {
  it("reads which characters a font has from its cmap", () => {
    expect(latin("A".codePointAt(0)!)).toBe(true);
    expect(latin("中".codePointAt(0)!)).toBe(false);
  });

  it("drops emoji as whole sequences: flags, ZWJ families, keycaps, variation selectors", () => {
    expect(fitText("🇯🇵ETF", everything)).toBe("ETF");
    expect(fitText("日经 🇯🇵 225", everything)).toBe("日经 225");
    expect(fitText("👨‍👩‍👧 家族 1️⃣ ❤️ ok", everything)).toBe("家族 ok");
  });

  it("without a CJK font, CJK text goes like the emoji, so the empty state draws nothing to fetch", () => {
    expect(fitText("暂无缓存的日线", latin)).toBe("");
    expect(fitText("英伟达 NVDA", latin)).toBe("NVDA");
    expect(fitText("market-hebi8.dreaife.tokyo/chart/=BTC/GOLD", latin)).toBe("market-hebi8.dreaife.tokyo/chart/=BTC/GOLD");
  });
});
