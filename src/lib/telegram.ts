/**
 * Binding a person's Telegram chat on a shared instance (design §2.5). A one-time code lives in
 * memory for 10 minutes and goes out as a `t.me/<bot>?start=<code>` link. While any code is
 * waiting, the instance's bot is long-polled with getUpdates for a private `/start <code>`; with
 * no code waiting nothing reads the bot, so it never competes with anything else. Outbound only.
 * The token stays on the server: it is in every URL here, so errors carry only the error name.
 */
import crypto from "node:crypto";
import { readNotifyConfig, sendTelegram, setUserChannel } from "./notify";

const CODE_TTL_MS = 10 * 60 * 1000;
const LONG_POLL_S = 25;
const RETRY_MS = 5000;

interface Bot {
  token: string;
  api: string;
}

interface Binding {
  /** As GitHub spells it, for the confirmation message */
  login: string;
  code: string;
  expiresAt: number;
  /** Set once the `/start` arrived */
  chat?: string;
}

interface Update {
  update_id: number;
  message?: { chat?: { id?: number | string; type?: string }; text?: string };
}

interface State {
  /** Pending and just-bound codes by lower-case login */
  bindings: Map<string, Binding>;
  /** Next getUpdates offset: everything before it has been seen */
  offset?: number;
  polling: boolean;
  /** Bot username by token, from getMe */
  botNames: Map<string, string>;
  lastError: string | null;
}

const g = globalThis as unknown as { hebi8Telegram?: State };
const state: State = (g.hebi8Telegram ??= { bindings: new Map(), polling: false, botNames: new Map(), lastError: null });

const log = (msg: string) => console.log(`[hebi8] telegram: ${msg}`);

async function call<T>(bot: Bot, method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${bot.api}/bot${bot.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    throw new Error(`Telegram ${method} 请求失败（${err instanceof Error ? err.name : "error"}）`);
  }
  const json = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; description?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(`Telegram ${method} ${res.status}${json?.description ? `：${json.description}` : ""}`);
  return json.result as T;
}

/** The instance's bot from notify.json, or null when there is none to bind to. */
export function instanceBot(): Bot | null {
  const t = readNotifyConfig().config.telegram;
  return t ? { token: t.token, api: t.api } : null;
}

async function botName(bot: Bot): Promise<string> {
  const known = state.botNames.get(bot.token);
  if (known) return known;
  const me = await call<{ username?: string }>(bot, "getMe", {});
  if (!me.username) throw new Error("Telegram getMe 没有返回 bot 用户名");
  state.botNames.set(bot.token, me.username);
  return me.username;
}

/** A new code for this login (replacing any earlier one) and the link that sends it to the bot. */
export async function startBinding(login: string, now = Date.now()): Promise<{ url: string; expiresAt: number }> {
  const bot = instanceBot();
  if (!bot) throw new Error("这台 hebi8 没有配置 Telegram bot（notify.json 的 telegram.token），请找部署的人");
  const name = await botName(bot);
  const code = crypto.randomBytes(9).toString("base64url");
  const expiresAt = now + CODE_TTL_MS;
  state.bindings.set(login.toLowerCase(), { login, code, expiresAt });
  void pollUpdates(bot);
  return { url: `https://t.me/${name}?start=${code}`, expiresAt };
}

export type BindingStatus = { status: "pending"; error?: string } | { status: "bound"; chat: string } | { status: "expired" };

/** What happened to this login's code; `bound` and `expired` are reported once. */
export function bindingStatus(login: string, now = Date.now()): BindingStatus {
  const key = login.toLowerCase();
  const b = state.bindings.get(key);
  if (b?.chat) {
    state.bindings.delete(key);
    return { status: "bound", chat: b.chat };
  }
  if (!b || b.expiresAt <= now) {
    state.bindings.delete(key);
    return { status: "expired" };
  }
  return state.lastError ? { status: "pending", error: state.lastError } : { status: "pending" };
}

const waiting = () => [...state.bindings.values()].some((b) => !b.chat && b.expiresAt > Date.now());

/** 取消 or 解除绑定: the waiting code stops working, and with nobody else waiting the polling ends. */
export function cancelBinding(login: string): void {
  const key = login.toLowerCase();
  if (!state.bindings.get(key)?.chat) state.bindings.delete(key);
}

/**
 * One loop per process while a code is waiting. An update is confirmed by asking for the next
 * offset; once nothing waits, a last `timeout: 0` call confirms the final batch (and whatever it
 * returns is handled like any other). A code started meanwhile keeps the same loop going.
 */
async function pollUpdates(bot: Bot): Promise<void> {
  if (state.polling) return;
  state.polling = true;
  // update ids can restart after a quiet week, so an offset is only trusted within one run
  state.offset = undefined;
  let unconfirmed = false;
  try {
    for (;;) {
      const busy = waiting();
      if (!busy && !unconfirmed) break;
      try {
        const updates: Update[] = await call<Update[]>(
          bot,
          "getUpdates",
          { offset: state.offset, timeout: busy ? LONG_POLL_S : 0, allowed_updates: ["message"] },
          (LONG_POLL_S + 10) * 1000,
        );
        state.lastError = null;
        unconfirmed = updates.length > 0;
        for (const u of updates) {
          state.offset = u.update_id + 1;
          await receive(bot, u);
        }
      } catch (err) {
        // e.g. 409 when something else reads the same bot: shown in the panel, retried
        state.lastError = err instanceof Error ? err.message : String(err);
        log(state.lastError);
        if (!busy) break;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    }
  } finally {
    state.polling = false;
  }
}

async function receive(bot: Bot, u: Update): Promise<void> {
  const chat = u.message?.chat;
  const code = /^\/start\s+(\S+)$/.exec(u.message?.text?.trim() ?? "")?.[1];
  if (chat?.type !== "private" || chat.id === undefined || !code) return;
  const binding = [...state.bindings.values()].find((b) => b.code === code && !b.chat && b.expiresAt > Date.now());
  if (!binding) return;
  const id = String(chat.id);
  setUserChannel(binding.login, "telegram", { chat: id });
  log(`bound ${binding.login}`);
  await sendTelegram({ ...bot, chat: id }, `已绑定 hebi8：${binding.login}`).catch((err) => log(`confirmation failed: ${err instanceof Error ? err.message : String(err)}`));
  // only now does the panel hear about it, so the confirmation is already in the chat
  binding.chat = id;
}
