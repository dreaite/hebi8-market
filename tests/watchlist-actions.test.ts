import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const YAML = `# 我的自选
aliases:
  BTC: binance:BTCUSDT # 比特币
  GOLD: tv:TVC:GOLD
groups:
  - name: 美股 # 先看美股
    symbols:
      - yahoo:SPY
      - { key: yahoo:QQQ, name: 纳指 } # 科技
      - yahoo:NVDA
  - name: 宏观
    symbols: [GOLD]
  - name: 加密
    symbols: [BTC]
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-watchlist-"));
const root = path.join(dir, "vault");
const yamlFile = path.join(root, "hebi8.yaml");
const read = () => fs.readFileSync(yamlFile, "utf8");

beforeAll(() => {
  process.env.HEBI8_VAULT = root;
  process.env.HEBI8_DB = path.join(dir, "hebi8.db");
  process.env.HEBI8_SECRETS = path.join(dir, "secrets");
  fs.mkdirSync(root);
});

afterAll(() => {
  delete process.env.HEBI8_VAULT;
  delete process.env.HEBI8_DB;
  delete process.env.HEBI8_SECRETS;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.writeFileSync(yamlFile, YAML);
});

const order = async () => {
  const { readConfig } = await import("@/lib/vault");
  return readConfig(root).groups.map((g) => `${g.name}:${g.symbols.map((s) => s.key.split(":").at(-1)).join(",")}`);
};

describe("watchlist Server Actions", () => {
  it("moves a symbol to a position, inside its group or into another, keeping comments and fields", async () => {
    const { moveSymbol } = await import("@/app/actions");
    expect(await moveSymbol("yahoo:NVDA", "美股", 0)).toEqual({ ok: true });
    expect(await order()).toEqual(["美股:NVDA,SPY,QQQ", "宏观:GOLD", "加密:BTCUSDT"]);
    expect(await moveSymbol("yahoo:QQQ", "加密", 0)).toEqual({ ok: true });
    expect(await order()).toEqual(["美股:NVDA,SPY", "宏观:GOLD", "加密:QQQ,BTCUSDT"]);
    expect(read()).toContain("{ key: yahoo:QQQ, name: 纳指 } # 科技");
    expect(read()).toContain("# 比特币");
    // no index: to the end, as the row menu's「移到分组」does
    expect(await moveSymbol("yahoo:SPY", "宏观")).toEqual({ ok: true });
    expect(await order()).toEqual(["美股:NVDA", "宏观:GOLD,SPY", "加密:QQQ,BTCUSDT"]);
  });

  it("adds, renames, moves and deletes groups; a deleted group's symbols join its neighbour", async () => {
    const { addGroup, deleteGroup, moveGroup, renameGroup } = await import("@/app/actions");
    expect(await addGroup("港 A")).toEqual({ ok: true });
    expect(await addGroup("港 A")).toEqual({ ok: false, error: "已经有「港 A」分组了" });
    expect(await renameGroup("美股", "美国")).toEqual({ ok: true });
    expect(read()).toContain("- name: 美国 # 先看美股");
    expect(await renameGroup("美国", "宏观")).toEqual({ ok: false, error: "已经有「宏观」分组了" });
    expect(await moveGroup("加密", 0)).toEqual({ ok: true });
    expect(await order()).toEqual(["加密:BTCUSDT", "美国:SPY,QQQ,NVDA", "宏观:GOLD", "港 A:"]);
    expect(await deleteGroup("宏观")).toEqual({ ok: true });
    expect(await order()).toEqual(["加密:BTCUSDT", "美国:SPY,QQQ,NVDA,GOLD", "港 A:"]);
    expect(await deleteGroup("加密")).toEqual({ ok: true });
    expect(await order()).toEqual(["美国:BTCUSDT,SPY,QQQ,NVDA,GOLD", "港 A:"]);
    expect(await deleteGroup("港 A")).toEqual({ ok: true });
    expect(await deleteGroup("美国")).toEqual({ ok: false, error: "这是唯一的分组，先移除里面的标的" });
    expect(await deleteGroup("nope")).toEqual({ ok: false, error: "没有「nope」这个分组" });
  });
});
