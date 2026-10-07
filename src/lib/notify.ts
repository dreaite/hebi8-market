/**
 * Outbound delivery of post-sync alerts. The instance's settings are written by hand in
 * `notify.json` in the secrets dir (never the vault): the Telegram bot, the chart link, and the
 * root vault's chat and webhook. On a shared instance each person's own channels are in
 * `notify-users.json`, written by the notification settings page. Every request is outbound,
 * nothing listens for webhooks.
 */
import fs from "node:fs";
import path from "node:path";
import { fmtPrice } from "./format";
import { readJson, secretsDir, writeJson } from "./secrets";
import { TF_LABELS, type Timeframe } from "./symbols";

export interface Webhook {
  url: string;
  format: "text" | "json";
}

export interface NotifyConfig {
  /** `chat` is where the root vault's alerts go; a bot without one only serves people who bind on the page */
  telegram?: { token: string; chat?: string; api: string };
  webhook?: Webhook;
  /** Base URL of this app, for chart links in messages */
  link?: string;
}

/** One person's channels in notify-users.json, keyed by lower-case login. */
export interface UserChannels {
  telegram?: { chat: string };
  webhook?: Webhook;
}

export interface AlertEvent {
  rule: string;
  key: string;
  /** Display name of the symbol */
  name: string;
  /** Condition label or alert label */
  label: string;
  tf: Timeframe;
  close: number | null;
}

export interface Delivery {
  sent: string[];
  failed: { channel: string; error: string }[];
}

const NOTIFY_FILE = "notify.json";
const TELEGRAM_API = "https://api.telegram.org";
/** Telegram rejects messages over 4096 characters. */
const MAX_TEXT = 4000;

const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

export function httpUrl(value: string, where: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${where} 不是有效的地址`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${where} 只支持 http 或 https`);
  return value.replace(/\/+$/, "");
}

/** Validate the hand-written file; a section that is present but incomplete is an error. */
export function parseNotifyConfig(raw: unknown): NotifyConfig {
  const root = obj(raw);
  if (!root) throw new Error("notify.json 应是一个对象");
  const out: NotifyConfig = {};
  if (root.telegram !== undefined) {
    const t = obj(root.telegram);
    const token = str(t?.token);
    const chat = str(t?.chat);
    if (!token) throw new Error("notify.json 的 telegram 需要 token");
    out.telegram = { token, ...(chat ? { chat } : {}), api: t?.api ? httpUrl(str(t.api) ?? "", "telegram.api") : TELEGRAM_API };
  }
  if (root.webhook !== undefined) {
    const w = typeof root.webhook === "string" ? { url: root.webhook } : obj(root.webhook);
    const url = str(w?.url);
    if (!url) throw new Error("notify.json 的 webhook 需要 url");
    const format = w?.format ?? "text";
    if (format !== "text" && format !== "json") throw new Error("notify.json 的 webhook.format 应为 text 或 json");
    out.webhook = { url: httpUrl(url, "webhook.url"), format };
  }
  if (root.link !== undefined) {
    const link = str(root.link);
    if (link) out.link = httpUrl(link, "link");
  }
  return out;
}

/** A missing file means no channels; a broken one is reported, not ignored. */
export function readNotifyConfig(): { config: NotifyConfig; error: string | null } {
  const file = path.join(secretsDir(), NOTIFY_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { config: {}, error: null };
  }
  try {
    return { config: parseNotifyConfig(JSON.parse(text)), error: null };
  } catch (err) {
    return { config: {}, error: err instanceof Error ? err.message : String(err) };
  }
}

const USERS_FILE = "notify-users.json";

export function readNotifyUsers(): Record<string, UserChannels> {
  return readJson<Record<string, UserChannels>>(USERS_FILE) ?? {};
}

/** Set (or with null, remove) one of a person's channels; someone left with none drops out of the file. */
export function setUserChannel<C extends keyof UserChannels>(login: string, channel: C, value: UserChannels[C] | null): void {
  const all = readNotifyUsers();
  const key = login.toLowerCase();
  const next: UserChannels = { ...all[key] };
  if (value) next[channel] = value;
  else delete next[channel];
  if (Object.keys(next).length) all[key] = next;
  else delete all[key];
  writeJson(USERS_FILE, all);
}

/**
 * Where one vault's alerts go. The root vault ('', single user or the owner) uses notify.json's
 * chat and webhook, each replaced by the owner's own binding from the page when there is one;
 * anyone else only ever gets what they bound. Telegram always goes through the instance's bot.
 */
export function channelsFor(vault: string, owner: string | null): { config: NotifyConfig; error: string | null } {
  const { config: instance, error } = readNotifyConfig();
  const login = vault || owner?.toLowerCase();
  const own = login ? readNotifyUsers()[login] : undefined;
  const chat = own?.telegram?.chat ?? (vault === "" ? instance.telegram?.chat : undefined);
  const webhook = own?.webhook ?? (vault === "" ? instance.webhook : undefined);
  const config: NotifyConfig = {};
  if (instance.telegram && chat) config.telegram = { ...instance.telegram, chat };
  if (webhook) config.webhook = webhook;
  if (instance.link) config.link = instance.link;
  return { config, error };
}

/** What the notification settings page shows: no chat id beyond its last 4 digits, no webhook beyond its host. */
export interface ChannelSummary {
  /** The instance has a Telegram bot to bind to */
  bot: boolean;
  /** `fromFile`: notify.json's, not bound on the page (the owner's fallback) */
  telegram: { chat: string; fromFile: boolean } | null;
  webhook: { host: string; format: Webhook["format"]; fromFile: boolean } | null;
}

export function channelSummary(vault: string, owner: string | null): ChannelSummary {
  const { config } = channelsFor(vault, owner);
  const own = readNotifyUsers()[vault || owner?.toLowerCase() || ""];
  const chat = config.telegram?.chat;
  return {
    bot: Boolean(readNotifyConfig().config.telegram),
    telegram: chat ? { chat: `…${chat.slice(-4)}`, fromFile: !own?.telegram } : null,
    webhook: config.webhook ? { host: new URL(config.webhook.url).host, format: config.webhook.format, fromFile: !own?.webhook } : null,
  };
}

/** What 发测试消息 and `npm run notify:test` send. */
export const testDigest = (link?: string) =>
  formatDigest([{ rule: "test", key: "binance:BTCUSDT", name: "测试", label: "通知通道可用", tf: "D", close: null }], link);

export const channelNames = (cfg: NotifyConfig): string[] =>
  [cfg.telegram?.chat ? "telegram" : null, cfg.webhook ? "webhook" : null].filter((c): c is string => c !== null);

export const chartLink = (base: string, key: string) => `${base}/chart/${encodeURIComponent(key)}`;

/** One plain-text digest for every event of a sync. */
export function formatDigest(events: AlertEvent[], link?: string): { title: string; text: string } {
  const title = `hebi8 · ${events.length} 条新提醒`;
  const lines = events.flatMap((e) => {
    const close = e.close === null ? "" : `  收 ${fmtPrice(e.close)}`;
    const head = `• ${e.name}：${e.label}（${TF_LABELS[e.tf]}线）${close}`;
    return link ? [head, `  ${chartLink(link, e.key)}`] : [head];
  });
  let text = [title, "", ...lines].join("\n");
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 2)}\n…`;
  return { title, text };
}

const TIMEOUT = 15_000;

export async function sendTelegram(cfg: { token: string; chat: string; api: string }, text: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${cfg.api}/bot${cfg.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chat, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (err) {
    // the URL carries the token, so only the error name goes into logs
    throw new Error(`Telegram 请求失败（${err instanceof Error ? err.name : "error"}）`);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { description?: string } | null;
    throw new Error(`Telegram ${res.status}${body?.description ? `：${body.description}` : ""}`);
  }
}

async function sendWebhook(cfg: NonNullable<NotifyConfig["webhook"]>, title: string, text: string, events: AlertEvent[]): Promise<void> {
  const init: RequestInit =
    cfg.format === "json"
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ title, text, events }) }
      : { headers: { "content-type": "text/plain; charset=utf-8", Title: "hebi8" }, body: text };
  let res: Response;
  try {
    res = await fetch(cfg.url, { method: "POST", ...init, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    // ntfy topics are secrets too, so the URL stays out of the message
    throw new Error(`webhook 请求失败（${err instanceof Error ? err.name : "error"}）`);
  }
  if (!res.ok) throw new Error(`webhook ${res.status}：${(await res.text().catch(() => "")).slice(0, 200)}`);
}

/** Every configured channel in parallel; one failing does not stop the others. */
export async function deliver(cfg: NotifyConfig, title: string, text: string, events: AlertEvent[] = []): Promise<Delivery> {
  const jobs: [string, () => Promise<void>][] = [];
  const telegram = cfg.telegram;
  const chat = telegram?.chat;
  if (telegram && chat) jobs.push(["telegram", () => sendTelegram({ ...telegram, chat }, text)]);
  if (cfg.webhook) jobs.push(["webhook", () => sendWebhook(cfg.webhook!, title, text, events)]);
  const results = await Promise.allSettled(jobs.map(([, job]) => job()));
  const out: Delivery = { sent: [], failed: [] };
  results.forEach((r, i) => {
    if (r.status === "fulfilled") out.sent.push(jobs[i][0]);
    else out.failed.push({ channel: jobs[i][0], error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
  });
  return out;
}
