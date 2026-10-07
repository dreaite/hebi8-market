/**
 * Counters for traffic monitoring (design §1.7): requests to this app, bumped by `src/proxy.ts`,
 * and calls to the upstream sources, bumped by `src/lib/sources/`. Both only add to maps in
 * memory; `src/lib/usage.ts` drains them into SQLite every 30 seconds. The maps hang off
 * `globalThis` because the proxy is its own bundle, loaded into the same Node process.
 *
 * No plain IP is kept anywhere: a visitor is an HMAC of the address with a salt from the secrets
 * dir. A session cookie is kept until the flush, which turns it into a login.
 */
import crypto from "node:crypto";
import { readJson, writeJson } from "./secrets";
import type { Source } from "./symbols";

/** Through the Cloudflare tunnel (a public host name) or straight over the tailnet */
export type Origin = "public" | "tailnet";
export type Kind = "page" | "prefetch" | "action" | "api";
export type Outcome = "ok" | "failed" | "limited";

export interface Hit {
  /** unix minutes; the flush turns them into local days */
  minute: number;
  origin: Origin;
  kind: Kind;
  path: string;
  visitor: string;
  /** the session cookie as sent, '' without one */
  session: string;
  n: number;
  /** unix seconds of the latest request */
  last: number;
}

export interface UpstreamHit {
  minute: number;
  source: Source;
  requests: number;
  /** limited ones included */
  failures: number;
  limited: number;
}

interface Counters {
  hits: Map<string, Hit>;
  upstream: Map<string, UpstreamHit>;
  salt?: string;
  /** Installed by the flusher; called when the buffer grows past `FLUSH_AT` keys */
  flushSoon?: () => void;
}

const FLUSH_AT = 5000;
const MAX_PATH = 200;
const SALT_FILE = "traffic-salt.json";

const g = globalThis as unknown as { hebi8mTraffic?: Counters };
const counters: Counters = (g.hebi8mTraffic ??= { hits: new Map(), upstream: new Map() });

/** Only the tunnel serves a public host name; IPs, single labels, localhost and MagicDNS names are the tailnet. */
export function originOf(host: string | null): Origin {
  const name = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!name || name.startsWith("[") || name === "localhost" || !name.includes(".") || name.endsWith(".ts.net")) return "tailnet";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(name) ? "tailnet" : "public";
}

/** Server Actions are POSTs to a page with `Next-Action`; router prefetches are counted apart from views. */
export function kindOf(pathname: string, headers: Headers): Kind {
  if (pathname === "/api" || pathname.startsWith("/api/")) return "api";
  if (headers.has("next-action")) return "action";
  if (headers.has("next-router-prefetch") || headers.has("next-router-segment-prefetch")) return "prefetch";
  return "page";
}

/**
 * The client address: `CF-Connecting-IP` behind the tunnel; on the tailnet the socket address,
 * which Next puts in `X-Forwarded-For` when nothing in front of it did.
 */
export function clientIp(origin: Origin, headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
  const ip = (origin === "public" ? headers.get("cf-connecting-ip")?.trim() : null) || forwarded;
  return ip.replace(/^::ffff:(?=\d+\.)/, "");
}

/** 16 hex digits of HMAC-SHA256: stable across days, useless without the salt. */
export const visitorId = (ip: string, salt: string) => (ip ? crypto.createHmac("sha256", salt).update(ip).digest("hex").slice(0, 16) : "-");

function salt(): string {
  if (counters.salt) return counters.salt;
  let value = readJson<{ salt?: string }>(SALT_FILE)?.salt;
  if (!value) {
    value = crypto.randomBytes(32).toString("base64url");
    writeJson(SALT_FILE, { salt: value });
  }
  return (counters.salt = value);
}

export interface RequestInfo {
  pathname: string;
  headers: Headers;
  session: string | undefined;
}

export function recordRequest(req: RequestInfo, now = Date.now()): void {
  const origin = originOf(req.headers.get("host"));
  const hit: Omit<Hit, "n" | "last"> = {
    minute: Math.floor(now / 60000),
    origin,
    kind: kindOf(req.pathname, req.headers),
    path: req.pathname.slice(0, MAX_PATH),
    visitor: visitorId(clientIp(origin, req.headers), salt()),
    session: req.session ?? "",
  };
  const key = [hit.minute, hit.origin, hit.kind, hit.path, hit.visitor, hit.session].join("\t");
  const seen = counters.hits.get(key);
  if (seen) {
    seen.n++;
    seen.last = Math.floor(now / 1000);
  } else {
    counters.hits.set(key, { ...hit, n: 1, last: Math.floor(now / 1000) });
    if (counters.hits.size >= FLUSH_AT) counters.flushSoon?.();
  }
}

/** HTTP 429 / 403 (and Binance's 418 ban), or an error that says so. */
export function isRateLimited(err: unknown): boolean {
  const e = err as { status?: unknown; statusCode?: unknown; code?: unknown; message?: unknown } | null;
  if ([e?.status, e?.statusCode, e?.code].some((s) => [403, 418, 429].includes(Number(s)))) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /\b(403|418|429)\b|too many requests|rate[ -]?limit|forbidden/i.test(message);
}

export function recordUpstream(source: Source, outcome: Outcome, now = Date.now()): void {
  const minute = Math.floor(now / 60000);
  const key = `${minute}\t${source}`;
  const row = counters.upstream.get(key) ?? { minute, source, requests: 0, failures: 0, limited: 0 };
  row.requests++;
  if (outcome !== "ok") row.failures++;
  if (outcome === "limited") row.limited++;
  counters.upstream.set(key, row);
}

/** Count one call to a source: the outcome comes from whether it threw and how. */
export async function countUpstream<T>(source: Source, call: () => Promise<T>): Promise<T> {
  try {
    const result = await call();
    recordUpstream(source, "ok");
    return result;
  } catch (err) {
    recordUpstream(source, isRateLimited(err) ? "limited" : "failed");
    throw err;
  }
}

/** Everything counted since the last drain; the buffer starts over. */
export function drainCounters(): { hits: Hit[]; upstream: UpstreamHit[] } {
  const out = { hits: [...counters.hits.values()], upstream: [...counters.upstream.values()] };
  counters.hits.clear();
  counters.upstream.clear();
  return out;
}

export function onBufferFull(flush: (() => void) | undefined): void {
  counters.flushSoon = flush;
}
