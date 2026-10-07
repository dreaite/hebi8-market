import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ session: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "hebi8m_session" && request.session ? { name, value: request.session } : undefined) }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const YAML = `# 我的警报
aliases:
  BTC: binance:BTCUSDT # 比特币
groups:
  - { name: 加密, symbols: [BTC] }
alerts: [] # 图表上建的写在这里
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-alert-actions-"));
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
  request.session = undefined;
});

describe("alert Server Actions", () => {
  it("create writes a block list entry with the alias, keeping comments", async () => {
    const { saveAlert } = await import("@/app/actions");
    const { readConfig } = await import("@/lib/vault");
    expect(await saveAlert({ key: "binance:BTCUSDT", cond: "crossing_up", value: 130000, trigger: "once" })).toEqual({ ok: true });
    expect(await saveAlert({ key: "binance:BTCUSDT", cond: "inside", value: [90000, 80000], trigger: "bar", label: "震荡区间" })).toEqual({ ok: true });
    const text = read();
    expect(text).toContain("# 比特币");
    expect(text).toContain("# 我的警报");
    expect(text).toContain("- { key: BTC, cond: crossing_up, value: 130000, trigger: once }");
    expect(text).toContain("- { key: BTC, cond: inside, value: [ 80000, 90000 ], trigger: bar, label: 震荡区间 }");
    expect(readConfig(root).alerts.map((a) => a.label)).toEqual(["BTC 上穿 130,000", "震荡区间"]);
  });

  it("edit replaces the entry in place and restarts it; pause, resume and delete find it by id", async () => {
    const { deleteAlert, saveAlert, setAlertEnabled } = await import("@/app/actions");
    const { readConfig } = await import("@/lib/vault");
    const { getDb } = await import("@/lib/db");
    await saveAlert({ key: "BTC", cond: "greater", value: 1, trigger: "once" });
    await saveAlert({ key: "BTC", cond: "less", value: 2, trigger: "once" });
    const [first, second] = readConfig(root).alerts;
    getDb().prepare("INSERT INTO alert_state (vault, rule, key, state, fired_at) VALUES ('', ?, ?, 1, 1)").run(first.id, first.key);

    expect(await saveAlert({ id: first.id, key: "BTC", cond: "greater", value: 5, trigger: "bar" })).toEqual({ ok: true });
    const edited = readConfig(root).alerts;
    expect(edited.map((a) => a.condition)).toEqual([{ cond: "greater", value: 5 }, { cond: "less", value: 2 }]);
    expect(getDb().prepare("SELECT count(*) AS n FROM alert_state WHERE rule = ?").get(first.id)).toEqual({ n: 0 });

    expect(await setAlertEnabled(second.id, false)).toEqual({ ok: true });
    expect(read()).toContain("cond: less, value: 2, trigger: once, enabled: false }");
    expect(await setAlertEnabled(second.id, true)).toEqual({ ok: true });
    expect(readConfig(root).alerts[1].enabled).toBe(true);
    expect(read()).not.toContain("enabled");

    expect(await deleteAlert(edited[0].id)).toEqual({ ok: true });
    expect(readConfig(root).alerts.map((a) => a.id)).toEqual([second.id]);
    expect(await saveAlert({ id: "alert:gone00", key: "BTC", cond: "less", value: 3, trigger: "once" })).toEqual({ ok: false, error: "这条警报已经不在 hebi8.yaml 里了" });
  });

  it("editing a hand-written alert changes only the fields the dialog has: tf, an explicit id and comments stay", async () => {
    const { saveAlert } = await import("@/app/actions");
    const { readConfig } = await import("@/lib/vault");
    fs.writeFileSync(
      yamlFile,
      YAML.replace(
        "alerts: [] # 图表上建的写在这里\n",
        `alerts:
  - key: yahoo:NVDA # 英伟达
    id: nvda-200
    tf: W # 周线
    when: "close < sma(close, 200)" # 200 周
    note: 自己记的
`,
      ),
    );
    const before = readConfig(root).alerts[0];
    expect(before).toMatchObject({ id: "alert:nvda-200", tf: "W", trigger: "once" });

    // only the name and the trigger change in the dialog
    expect(await saveAlert({ id: before.id, key: "yahoo:NVDA", cond: "formula", when: before.when!, trigger: "bar", label: "破 200 周" })).toEqual({ ok: true });
    let text = read();
    for (const kept of ["key: yahoo:NVDA # 英伟达", "id: nvda-200", "tf: W # 周线", 'when: "close < sma(close, 200)" # 200 周', "note: 自己记的", "trigger: bar", "label: 破 200 周"]) {
      expect(text).toContain(kept);
    }
    expect(readConfig(root).alerts[0]).toMatchObject({ id: "alert:nvda-200", tf: "W", trigger: "bar", label: "破 200 周" });

    // turned into a condition: the formula and its tf go, the id and the key's comment stay
    expect(await saveAlert({ id: before.id, key: "yahoo:NVDA", cond: "less", value: 100, trigger: "bar" })).toEqual({ ok: true });
    text = read();
    expect(text).toContain("key: yahoo:NVDA # 英伟达");
    expect(text).not.toContain("when:");
    expect(text).not.toContain("tf:");
    expect(text).not.toContain("label:");
    expect(readConfig(root).alerts[0]).toMatchObject({ id: "alert:nvda-200", condition: { cond: "less", value: 100 }, tf: "D" });
  });

  it("checks the input and the formula", async () => {
    const { saveAlert } = await import("@/app/actions");
    expect(await saveAlert({ key: "BTC", cond: "greater", value: Number.NaN, trigger: "once" })).toEqual({ ok: false, error: "greater 的 value 应是一个价格" });
    expect((await saveAlert({ key: "BTC", cond: "formula", when: "close >", trigger: "once" })).ok).toBe(false);
    expect(await saveAlert({ key: "BTC", cond: "formula", when: "cross(close, sma(close, 20))", trigger: "bar" })).toEqual({ ok: true });
    expect(await saveAlert({ key: "BTC", cond: "greater", value: 1, trigger: "once" })).toEqual({ ok: true });
    expect((await saveAlert({ key: "BTC", cond: "greater", value: 1, trigger: "bar" })).ok).toBe(false); // same condition twice
    expect(read()).toContain('when: "cross(close, sma(close, 20))"');
  });

  it("refuses a visitor on a shared instance", async () => {
    const { saveAlert, deleteAlert, setAlertEnabled } = await import("@/app/actions");
    fs.writeFileSync(yamlFile, `owner: someone\n${YAML}`);
    for (const result of [await saveAlert({ key: "BTC", cond: "greater", value: 1, trigger: "once" }), await deleteAlert("alert:x"), await setAlertEnabled("alert:x", false)]) {
      expect(result).toEqual({ ok: false, error: "请先登录" });
    }
    expect(read()).toBe(`owner: someone\n${YAML}`);
  });
});

describe("the alert list", () => {
  it("tells a fired once alert (已触发) from a paused one (已停止) and draws only active levels", async () => {
    const { alertViews } = await import("@/lib/alert-view");
    const { normalizeConfig } = await import("@/lib/config");
    const { getDb } = await import("@/lib/db");
    const cfg = normalizeConfig({
      aliases: { BTC: "binance:BTCUSDT" },
      alerts: [
        { key: "BTC", cond: "entering", value: [1, 2] },
        { key: "BTC", cond: "greater", value: 3, enabled: false },
        { key: "BTC", cond: "less", value: 4, enabled: false },
      ],
    });
    getDb().prepare("INSERT OR REPLACE INTO alert_state (vault, rule, key, state, fired_at) VALUES ('', ?, 'binance:BTCUSDT', 1, 5)").run(cfg.alerts[1].id);
    const views = alertViews("", cfg, {});
    expect(views.map((v) => [v.status, v.levels])).toEqual([
      ["active", [1, 2]],
      ["triggered", []],
      ["stopped", []],
    ]);
  });
});
