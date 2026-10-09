/**
 * Web Push (design §2.7): the instance's VAPID keys and one request to a push service. The keys
 * are made the first time anything needs them and kept in `vapid.json` in the secrets dir; the
 * payload is encrypted by `web-push`, the request goes out with fetch like every other channel.
 * Which devices someone has is in notify-users.json, kept by `notify.ts`.
 */
import webpush from "web-push";
import { publicUrl } from "./app-info";
import { readJson, writeJson } from "./secrets";

export interface PushDevice {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  /** Browser and system, from the User-Agent it subscribed with */
  label: string;
  /** ms */
  added: number;
}

/** What public/sw.js shows: `url` is a path on this app, opened when the notification is tapped. */
export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

const VAPID_FILE = "vapid.json";
/** An alert a day late is no use; a phone that is off longer than this misses it */
const TTL = 24 * 3600;
const TIMEOUT = 15_000;

export function vapidKeys(): { publicKey: string; privateKey: string } {
  const saved = readJson<{ publicKey: string; privateKey: string }>(VAPID_FILE);
  if (saved) return saved;
  const keys = webpush.generateVAPIDKeys();
  writeJson(VAPID_FILE, keys);
  return keys;
}

/** "gone": the push service says the subscription no longer exists (404/410), so it can be dropped. */
export async function sendPush(device: PushDevice, payload: PushPayload): Promise<"sent" | "gone"> {
  const { publicKey, privateKey } = vapidKeys();
  const req = webpush.generateRequestDetails({ endpoint: device.endpoint, keys: device.keys }, JSON.stringify(payload), {
    // push services contact this address about misbehaving senders; Apple requires https: or mailto:
    vapidDetails: { subject: publicUrl(), publicKey, privateKey },
    TTL,
    urgency: "high",
  });
  const host = new URL(device.endpoint).host;
  let res: Response;
  try {
    res = await fetch(req.endpoint, { method: req.method, headers: req.headers, body: new Uint8Array(req.body), signal: AbortSignal.timeout(TIMEOUT) });
  } catch (err) {
    // the endpoint is the subscription's secret, so only its host goes into logs
    throw new Error(`${host} 请求失败（${err instanceof Error ? err.name : "error"}）`);
  }
  if (res.status === 404 || res.status === 410) return "gone";
  if (!res.ok) throw new Error(`${host} ${res.status}：${(await res.text().catch(() => "")).slice(0, 200)}`);
  return "sent";
}

const BROWSERS: [RegExp, string][] = [
  [/Edg\//, "Edge"],
  [/Firefox\/|FxiOS/, "Firefox"],
  [/Chrome\/|CriOS/, "Chrome"],
  [/Safari\//, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Mac OS X/, "macOS"],
  [/Windows/, "Windows"],
  [/Linux/, "Linux"],
];

/** A short name for the device list, e.g. "Chrome · Android". */
export function deviceLabel(ua: string): string {
  const pick = (list: [RegExp, string][]) => list.find(([re]) => re.test(ua))?.[1];
  return [pick(BROWSERS) ?? "浏览器", pick(SYSTEMS)].filter(Boolean).join(" · ");
}
