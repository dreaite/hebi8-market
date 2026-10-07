import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, normalizeConfig, normalizeUserConfig } from "@/lib/config";

// Server Actions read the session cookie through next/headers; here it is whatever the test says.
const request = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "hebi8_session" && request.session ? { name, value: request.session } : undefined) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const ROOT_YAML = `# 共用实例的根 vault
owner: Dreaife # 实例主人
sync:
  at: ["07:30"]
  tz: Asia/Tokyo
updown: green-up
aliases:
  BTC: binance:BTCUSDT # 比特币
groups:
  # 先看币
  - name: 加密
    symbols: [BTC]
conditions:
  - { id: up, label: 上涨, formula: "close > ref(close, 1)", tf: D }
alerts:
  - { key: BTC, label: 站上 100, when: "close > 100" }
datasets:
  gpu: ./gpu
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8-shared-"));
const root = path.join(dir, "vault");
const users = path.join(root, "users");
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");
const writeRoot = (text: string) => fs.writeFileSync(path.join(root, "hebi8.yaml"), text);

let sessions: Record<string, string>;

beforeAll(async () => {
  process.env.HEBI8_VAULT = root;
  process.env.HEBI8_DB = path.join(dir, "data", "hebi8.db");
  process.env.HEBI8_SECRETS = path.join(dir, "secrets");
  fs.mkdirSync(root);
  writeRoot(ROOT_YAML);
  const { createSession } = await import("@/lib/secrets");
  const as = (login: string) => createSession({ login, avatar_url: `https://avatars.example/${login}`, access_token: "t", access_expires_at: null, refresh_token: null, refresh_expires_at: null });
  sessions = { owner: as("dreaife"), alice: as("Alice"), aliceUpper: as("ALICE"), bob: as("bob"), evil: as("../evil") };
});

afterAll(() => {
  delete process.env.HEBI8_VAULT;
  delete process.env.HEBI8_DB;
  delete process.env.HEBI8_SECRETS;
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  request.session = undefined;
});

describe("owner in hebi8.yaml", () => {
  it("must look like a GitHub login", () => {
    expect(normalizeConfig({ owner: "Dreaife" }).owner).toBe("Dreaife");
    expect(normalizeConfig({}).owner).toBeNull();
    expect(() => normalizeConfig({ owner: "../x" })).toThrow(ConfigError);
    expect(() => normalizeConfig({ owner: "a--b" })).toThrow(ConfigError);
  });

  it("is ignored in a user's yaml, with sync and datasets, which come from the root", () => {
    const rootCfg = normalizeConfig({ owner: "o", sync: { at: ["06:00"], tz: "UTC" }, datasets: { gpu: "./gpu" } });
    const cfg = normalizeUserConfig({ owner: "me", sync: { tz: "Mars/Olympus" }, datasets: { x: "bad" }, updown: "red-up" }, rootCfg);
    expect(cfg).toMatchObject({ owner: "o", sync: { at: ["06:00"], tz: "UTC" }, datasets: { gpu: "./gpu" }, updown: "red-up" });
    expect(cfg.ignored).toEqual(["owner", "sync", "datasets"]);
    expect(normalizeUserConfig({}, rootCfg).ignored).toEqual([]);
  });
});

describe("resolveViewer", () => {
  it("single-user mode: everyone reads and writes the root vault, logged in or not", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    writeRoot(ROOT_YAML.replace(/^owner:.*\n/m, ""));
    try {
      for (const id of [undefined, sessions.alice]) {
        expect(resolveViewer(id)).toMatchObject({ vault: "", dir: root, canWrite: true, isOwner: false, shared: false });
      }
      expect(resolveViewer(sessions.alice).login).toBe("Alice");
      expect(fs.existsSync(users)).toBe(false);
    } finally {
      writeRoot(ROOT_YAML);
    }
  });

  it("shared, not logged in: the root vault, read only", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    expect(resolveViewer(undefined)).toEqual({ vault: "", dir: root, login: null, avatarUrl: null, canWrite: false, isOwner: false, shared: true, owner: "Dreaife" });
    expect(resolveViewer("not-a-session-id-at-all-xxxxxxxx")).toMatchObject({ vault: "", canWrite: false });
  });

  it("shared, the owner (case-insensitive): the root vault with write access", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    expect(resolveViewer(sessions.owner)).toMatchObject({ vault: "", dir: root, login: "dreaife", canWrite: true, isOwner: true, shared: true });
  });

  it("shared, anyone else: their own lower-case vault, started from the root yaml", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    const alice = resolveViewer(sessions.alice);
    expect(alice).toMatchObject({ vault: "alice", dir: path.join(users, "alice"), login: "Alice", canWrite: true, isOwner: false, shared: true });

    const text = read(users, "alice", "hebi8.yaml");
    for (const gone of ["owner:", "sync:", "datasets:", "alerts:", "站上 100"]) expect(text).not.toContain(gone);
    expect(text.startsWith("# 共用实例的根 vault\n")).toBe(true);
    expect(text).toContain("# 比特币");
    expect(text).toContain("# 先看币");
    expect(text).toContain("{ id: up, label: 上涨");
    expect(fs.existsSync(path.join(users, "alice", "notes"))).toBe(false);

    const { readConfig } = await import("@/lib/vault");
    const cfg = readConfig(alice.dir);
    expect(cfg).toMatchObject({ owner: "Dreaife", sync: { at: ["07:30"], tz: "Asia/Tokyo" }, datasets: { gpu: "./gpu" }, alerts: [], ignored: [] });
    expect(cfg.groups[0].symbols[0].key).toBe("binance:BTCUSDT");

    // the copy happens once; later changes to either side stay apart
    fs.appendFileSync(path.join(users, "alice", "hebi8.yaml"), "periods: [1M]\n");
    expect(resolveViewer(sessions.aliceUpper)).toMatchObject({ vault: "alice", dir: path.join(users, "alice"), login: "ALICE" });
    expect(read(users, "alice", "hebi8.yaml")).toContain("periods: [1M]");
    expect(read(root, "hebi8.yaml")).toBe(ROOT_YAML);
  });

  it("treats a session whose login is not a GitHub login as nobody", async () => {
    const { resolveViewer } = await import("@/lib/viewer");
    const { userVaultDir } = await import("@/lib/vault");
    expect(resolveViewer(sessions.evil)).toMatchObject({ vault: "", login: null, canWrite: false });
    expect(fs.existsSync(path.join(root, "evil"))).toBe(false);
    expect(() => userVaultDir("../evil")).toThrow(/无效的 GitHub 用户名/);
    expect(() => userVaultDir("a/b")).toThrow();
    expect(userVaultDir("MiXeD")).toBe(path.join(users, "mixed"));
  });
});

describe("Server Actions write as the viewer", () => {
  const note = (vaultDir: string) => path.join(vaultDir, "notes", "binance_BTCUSDT.md");

  it("refuses visitors who are not logged in on a shared instance", async () => {
    const { saveNote, saveJournal, setUpdown, removeSymbol } = await import("@/app/actions");
    for (const result of [await saveNote("binance:BTCUSDT", "x"), await saveJournal("2026-W41", "x"), await setUpdown("red-up"), await removeSymbol("binance:BTCUSDT")]) {
      expect(result).toEqual({ ok: false, error: "请先登录" });
    }
    expect(fs.existsSync(note(root))).toBe(false);
    expect(fs.existsSync(path.join(root, "journal"))).toBe(false);
    expect(read(root, "hebi8.yaml")).toBe(ROOT_YAML);
  });

  it("puts each person's writes in their own vault only", async () => {
    const { saveNote, setUpdown } = await import("@/app/actions");
    const { readConfig, readNote } = await import("@/lib/vault");
    const alice = path.join(users, "alice");
    const bob = path.join(users, "bob");

    request.session = sessions.alice;
    expect(await saveNote("binance:BTCUSDT", "Alice 的笔记")).toEqual({ ok: true });
    expect(await setUpdown("red-up")).toEqual({ ok: true });
    request.session = sessions.bob;
    expect(await saveNote("binance:BTCUSDT", "Bob 的笔记")).toEqual({ ok: true });
    request.session = sessions.owner;
    expect(await saveNote("binance:BTCUSDT", "主人的笔记")).toEqual({ ok: true });

    expect(readNote(alice, "binance:BTCUSDT")).toBe("Alice 的笔记\n");
    expect(readNote(bob, "binance:BTCUSDT")).toBe("Bob 的笔记\n");
    expect(readNote(root, "binance:BTCUSDT")).toBe("主人的笔记\n");
    expect(readConfig(alice).updown).toBe("red-up");
    expect(readConfig(bob).updown).toBe("green-up");
    expect(readConfig(root).updown).toBe("green-up");

    // the same person in another case is the same vault
    request.session = sessions.aliceUpper;
    expect(await saveNote("binance:BTCUSDT", "还是 Alice")).toEqual({ ok: true });
    expect(readNote(alice, "binance:BTCUSDT")).toBe("还是 Alice\n");
    expect(fs.readdirSync(users).sort()).toEqual(["alice", "bob"]);
  });
});

describe("sync across vaults", () => {
  it("fetches the union of every vault's keys and comparisons, skipping broken and stale vaults", async () => {
    const { loadVaults, unionSyncKeys } = await import("@/lib/sync");
    const { writeChartState } = await import("@/lib/vault");
    const alice = path.join(users, "alice");
    fs.writeFileSync(path.join(alice, "hebi8.yaml"), read(alice, "hebi8.yaml").replace(/symbols: \[ ?BTC ?\]/, "symbols: [BTC, yahoo:SPY]"));
    writeChartState(alice, "yahoo:SPY", { compare: [{ key: "yahoo:QQQ", mode: "percent", color: "#0e9aa7" }], overlays: [] });
    fs.writeFileSync(path.join(users, "bob", "hebi8.yaml"), "groups: [oops");
    // the owner's vault is the root one, whatever is left under users/
    fs.mkdirSync(path.join(users, "dreaife"));
    fs.writeFileSync(path.join(users, "dreaife", "hebi8.yaml"), "groups:\n  - { name: x, symbols: [tv:TVC:GOLD] }\n");

    const vaults = loadVaults();
    expect(vaults.map((v) => v.id)).toEqual(["", "alice"]);
    const keys = unionSyncKeys(vaults);
    expect(keys.sort()).toEqual(["binance:BTCUSDT", "yahoo:QQQ", "yahoo:SPY"]);

    // single-user mode: only the root vault counts
    writeRoot(ROOT_YAML.replace(/^owner:.*\n/m, ""));
    try {
      expect(loadVaults().map((v) => v.id)).toEqual([""]);
      expect(unionSyncKeys(loadVaults())).toEqual(["binance:BTCUSDT"]);
    } finally {
      writeRoot(ROOT_YAML);
    }
  });
});

describe("stats and alerts per vault", () => {
  const KEY = "binance:BTCUSDT";
  const t0 = Date.UTC(2026, 0, 1) / 1000;
  const bars = (closes: number[]) => closes.map((c, i) => ({ t: t0 + i * 86400, o: c, h: c, l: c, c, v: 1, adj: 1 }));
  const rootCfg = normalizeConfig({
    aliases: { BTC: KEY },
    groups: [{ name: "加密", symbols: ["BTC"] }],
    conditions: [{ id: "up", label: "上涨", formula: "close > ref(close, 1)", tf: "D" }],
    alerts: [{ key: "BTC", label: "站上 100", when: "close > 100" }],
  });
  const aliceCfg = normalizeConfig({
    aliases: { BTC: KEY },
    groups: [{ name: "币", symbols: ["BTC"] }],
    conditions: [{ id: "down", label: "下跌", formula: "close < ref(close, 1)", tf: "D", notify: true }],
  });

  it("keeps each vault's conditions in its own stats rows", async () => {
    const { recomputeStats } = await import("@/lib/sync");
    const { ensureSymbol, readAllStats, writeBars } = await import("@/lib/store");
    ensureSymbol(KEY);
    writeBars(KEY, bars([90, 95, 101]), "replace");
    recomputeStats("", rootCfg);
    recomputeStats("alice", aliceCfg);
    expect(Object.keys(readAllStats("")[KEY].conditions)).toEqual(["up"]);
    expect(Object.keys(readAllStats("alice")[KEY].conditions)).toEqual(["down"]);
    expect(readAllStats("")[KEY].conditions.up.now).toBe(true);
    expect(readAllStats("alice")[KEY].conditions.down.now).toBe(false);
    expect(readAllStats("bob")).toEqual({});
  });

  it("computes a vault's stats from the cache the first time a page asks", async () => {
    const { statsFor } = await import("@/lib/sync");
    const { readAllStats } = await import("@/lib/store");
    expect(readAllStats("carol")).toEqual({});
    expect(statsFor("carol", aliceCfg)[KEY].conditions.down.now).toBe(false);
    expect(Object.keys(readAllStats("carol"))).toEqual([KEY]);
  });

  it("judges each vault's rules against its own state", async () => {
    const { runAlerts } = await import("@/lib/alerts");
    const { writeBars } = await import("@/lib/store");
    const { getDb } = await import("@/lib/db");
    const run = async () => ({ root: (await runAlerts("", rootCfg, new Map())).map((e) => e.rule), alice: (await runAlerts("alice", aliceCfg, new Map())).map((e) => e.rule) });

    writeBars(KEY, bars([90, 95, 101]), "replace");
    expect(await run()).toEqual({ root: [], alice: [] }); // first sighting everywhere
    const rows = getDb().prepare("SELECT vault, rule FROM alert_state ORDER BY vault").all();
    expect(rows).toEqual([
      { vault: "", rule: rootCfg.alerts[0].id },
      { vault: "alice", rule: "cond:down" },
    ]);

    writeBars(KEY, bars([90, 95, 101, 99]), "replace");
    expect(await run()).toEqual({ root: [], alice: ["cond:down"] });
    // the root rule's row survived Alice's run, so its turn is noticed
    writeBars(KEY, bars([90, 95, 101, 99, 102]), "replace");
    expect(await run()).toEqual({ root: [rootCfg.alerts[0].id], alice: [] });
  });
});
