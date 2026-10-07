import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const OLD = "111:OLD-token";
const NEW = "222:NEW-token";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8m-tg-switch-"));
const secrets = path.join(dir, "secrets");
const polls: { token: string; offset: unknown }[] = [];
const updates: Record<string, { update_id: number; message: { chat: { id: number; type: string }; text: string } }[]> = { [OLD]: [], [NEW]: [] };

// two bots; the old one's long poll stays open until the client gives up on it
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    const [, token, method] = /^\/bot([^/]+)\/(\w+)$/.exec(req.url ?? "") ?? [];
    const reply = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
    res.setHeader("content-type", "application/json");
    if (method === "getMe") return reply({ username: token === OLD ? "old_bot" : "new_bot" });
    if (method === "sendMessage") return reply({ message_id: 1 });
    const body = JSON.parse(raw || "{}") as { offset?: number; timeout?: number };
    polls.push({ token, offset: body.offset });
    if (token === OLD) {
      req.socket.on("close", () => res.destroy());
      return; // never answers
    }
    if (body.timeout && updates[token].length === 0) await new Promise((r) => setTimeout(r, 50));
    reply(updates[token].filter((u) => u.update_id >= (body.offset ?? 0)));
  });
});

let api: string;
const writeNotify = (token: string) => fs.writeFileSync(path.join(secrets, "notify.json"), JSON.stringify({ telegram: { token, api } }));
const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
};

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.HEBI8_SECRETS = secrets;
  fs.mkdirSync(secrets);
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
  delete process.env.HEBI8_SECRETS;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a new instance bot", () => {
  it("voids the codes of the old bot, stops its polling and binds through the new one", async () => {
    const { bindingStatus, resetBindings, startBinding } = await import("@/lib/telegram");
    const { readNotifyUsers } = await import("@/lib/notify");
    writeNotify(OLD);
    expect((await startBinding("alice")).url).toMatch(/^https:\/\/t\.me\/old_bot\?start=/);
    await until(() => polls.some((p) => p.token === OLD));

    // the owner saves another token (what PUT /api/notify/bot does)
    writeNotify(NEW);
    resetBindings();
    expect(bindingStatus("alice")).toEqual({ status: "expired" });

    const { url } = await startBinding("bob");
    expect(url).toMatch(/^https:\/\/t\.me\/new_bot\?start=/);
    await until(() => polls.some((p) => p.token === NEW));
    updates[NEW].push({ update_id: 5, message: { chat: { id: 55, type: "private" }, text: `/start ${new URL(url).searchParams.get("start")}` } });
    let status = bindingStatus("bob");
    await until(() => (status = bindingStatus("bob")).status !== "pending");
    expect(status).toEqual({ status: "bound", chat: "55" });
    expect(readNotifyUsers()).toEqual({ bob: { telegram: { chat: "55" } } });
    // the old bot was asked once and never again
    expect(polls.filter((p) => p.token === OLD)).toHaveLength(1);
  });
});
