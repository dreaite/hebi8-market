import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-list-order-"));
const root = path.join(dir, "vault");
const yamlFile = path.join(root, "hebi8.yaml");

beforeAll(() => {
  process.env.HEBI8_VAULT = root;
  fs.mkdirSync(root);
});

afterAll(() => {
  delete process.env.HEBI8_VAULT;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a new person's list", () => {
  it("starts with 美股、宏观、加密, the owner's other groups after them in the owner's order", async () => {
    fs.writeFileSync(yamlFile, `owner: dreaife\ngroups:\n  - { name: 港 A, symbols: [] }\n  - { name: 加密, symbols: [BTC] }\n  - { name: 比价, symbols: [] }\n  - { name: 美股, symbols: [] }\n  - { name: 宏观, symbols: [] }\naliases:\n  BTC: binance:BTCUSDT\n`);
    const { ensureUserVault, readConfig } = await import("@/lib/vault");
    const userDir = ensureUserVault("alice");
    expect(readConfig(userDir).groups.map((g) => g.name)).toEqual(["美股", "宏观", "加密", "港 A", "比价"]);
  });

  it("the example vault already starts that way", async () => {
    const { normalizeConfig } = await import("@/lib/config");
    const { parse } = await import("yaml");
    const example = normalizeConfig(parse(fs.readFileSync(path.join(process.cwd(), "vault.example", "hebi8.yaml"), "utf8")));
    expect(example.groups.slice(0, 3).map((g) => g.name)).toEqual(["美股", "宏观", "加密"]);
  });
});
