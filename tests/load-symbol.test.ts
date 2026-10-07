import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
// no network here: opening a symbol only has to ask sync for its bars
const synced = vi.hoisted(() => ({ keys: [] as string[], fail: null as string | null }));
vi.mock("@/lib/sync", async (original) => ({
  ...(await original<typeof import("@/lib/sync")>()),
  syncOne: async (key: string) => {
    synced.keys.push(key);
    return key === synced.fail ? { key, ok: false, error: "not found" } : { key, ok: true, bars: 1 };
  },
}));

const YAML = `aliases:
  BTC: binance:BTCUSDT
  GOLD: tv:TVC:GOLD
groups:
  - { name: 美股, symbols: [yahoo:SPY] }
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-load-symbol-"));
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
  synced.keys = [];
  synced.fail = null;
});

describe("loadSymbol", () => {
  it("opening a symbol no list has fetches its bars (synthetic operands too) and leaves the yaml alone", async () => {
    const { loadSymbol } = await import("@/app/actions");
    expect(await loadSymbol("yahoo:AAPL")).toEqual({ ok: true });
    expect(await loadSymbol("=BTC/GOLD")).toEqual({ ok: true });
    expect(synced.keys).toEqual(["yahoo:AAPL", "binance:BTCUSDT", "tv:TVC:GOLD"]);
    synced.fail = "yahoo:NOPE";
    expect(await loadSymbol("yahoo:NOPE")).toEqual({ ok: false, error: "拉取 yahoo:NOPE 失败：not found" });
    expect(read()).toBe(YAML);
  });
});
