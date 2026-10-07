import { describe, expect, it } from "vitest";
import { applyOp, mergeTarget, stepGroup, stepSymbol, type ListGroup } from "@/lib/watchlist";

const list = (): ListGroup<{ key: string }>[] => [
  { name: "美股", items: [{ key: "a" }, { key: "b" }, { key: "c" }] },
  { name: "宏观", items: [] },
  { name: "加密", items: [{ key: "x" }] },
];
const keys = (groups: ListGroup<{ key: string }>[]) => groups.map((g) => `${g.name}:${g.items.map((i) => i.key).join("")}`);

describe("watchlist edits (what the page shows before the yaml is written)", () => {
  it("moves a symbol within its group and into another, counting without the moved one", () => {
    expect(keys(applyOp(list(), { type: "moveSymbol", key: "a", group: "美股", index: 2 }))).toEqual(["美股:bca", "宏观:", "加密:x"]);
    expect(keys(applyOp(list(), { type: "moveSymbol", key: "c", group: "美股", index: 0 }))).toEqual(["美股:cab", "宏观:", "加密:x"]);
    expect(keys(applyOp(list(), { type: "moveSymbol", key: "b", group: "宏观", index: 0 }))).toEqual(["美股:ac", "宏观:b", "加密:x"]);
    expect(keys(applyOp(list(), { type: "moveSymbol", key: "x", group: "新组", index: 0 }))).toEqual(["美股:abc", "宏观:", "加密:", "新组:x"]);
  });

  it("moves, adds, renames and deletes groups; a deleted group's symbols join the one above, or below for the first", () => {
    expect(keys(applyOp(list(), { type: "moveGroup", name: "加密", index: 0 }))).toEqual(["加密:x", "美股:abc", "宏观:"]);
    expect(keys(applyOp(list(), { type: "addGroup", name: "港 A" })).at(-1)).toBe("港 A:");
    expect(keys(applyOp(list(), { type: "renameGroup", name: "宏观", next: "指数" }))[1]).toBe("指数:");
    expect(keys(applyOp(list(), { type: "deleteGroup", name: "加密" }))).toEqual(["美股:abc", "宏观:x"]);
    expect(keys(applyOp(list(), { type: "deleteGroup", name: "美股" }))).toEqual(["宏观:abc", "加密:x"]);
    expect(mergeTarget(list(), "美股")).toBe("宏观");
    expect(mergeTarget(list(), "加密")).toBe("宏观");
    expect(mergeTarget([{ name: "only", items: [] }], "only")).toBeNull();
  });

  it("steps with the keyboard across group edges, and stops at either end", () => {
    expect(stepSymbol(list(), "b", -1)).toEqual({ group: "美股", index: 0 });
    expect(stepSymbol(list(), "c", 1)).toEqual({ group: "宏观", index: 0 });
    expect(stepSymbol(list(), "x", -1)).toEqual({ group: "宏观", index: 0 });
    expect(stepSymbol(list(), "a", -1)).toBeNull();
    expect(stepSymbol(list(), "x", 1)).toBeNull();
    expect(stepGroup(list(), "宏观", -1)).toBe(0);
    expect(stepGroup(list(), "加密", 1)).toBeNull();
  });
});
