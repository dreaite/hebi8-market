import { describe, expect, it } from "vitest";
import { dashOf, drawingStyles, withAlpha, type LineDash } from "@/components/drawing-style";
import { DRAW_GROUPS, DRAW_TOOLS } from "@/components/chart-types";
import { DRAW_ICONS } from "@/components/chart-icons";

describe("drawing styles", () => {
  it("round-trips the dash the floating toolbar picked", () => {
    for (const dash of ["solid", "dashed", "dotted"] as LineDash[]) {
      const line = drawingStyles("#2962ff", 2, dash).line!;
      expect(dashOf({ style: line.style!, dashedValue: line.dashedValue as number[] })).toBe(dash);
    }
  });

  it("colours outlines and fills from the line colour", () => {
    const s = drawingStyles("#f23645", 3, "solid");
    expect(s.line).toMatchObject({ color: "#f23645", size: 3, style: "solid" });
    expect(s.polygon).toMatchObject({ borderColor: "#f23645", borderSize: 3, color: withAlpha("#f23645", 0.12) });
    expect(withAlpha("#f23645", 0.5)).toBe("rgba(242, 54, 69, 0.5)");
  });
});

describe("drawing tools", () => {
  it("names each tool once and gives every one an icon", () => {
    const names = DRAW_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(DRAW_ICONS[name], name).toBeTypeOf("function");
    expect(DRAW_GROUPS.map((g) => g.id)).toEqual(["lines", "fib", "patterns", "forecast", "shapes", "annotation"]);
  });

  it("keeps the TradingView hotkeys unique", () => {
    const codes = DRAW_TOOLS.flatMap((t) => (t.code ? [t.code] : []));
    expect(new Set(codes).size).toBe(codes.length);
  });
});
