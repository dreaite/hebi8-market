/**
 * Every GitHub HTTP call goes through here: the two logins (the web login's redirect and the
 * device flow, with refresh), the user, and the issues API. The device flow needs only the public
 * App's client id; the web login has a client id and secret in the secrets dir
 * (`github-oauth.json`). There is no private key or installation token anywhere. Failures become
 * `GitHubError` with a Chinese message the UI shows as is. Tokens, device codes and the client
 * secret never leave the server and are never logged.
 */
import crypto from "node:crypto";
import { FROM_APP_LABEL, githubClientId, publicUrl } from "./app-info";
import { getSession, readJson, updateSession, type Session } from "./secrets";

const API = "https://api.github.com";
const WEB = "https://github.com";

export class GitHubError extends Error {
  /** HTTP status from GitHub, 0 when GitHub could not be reached, 401 when the login is gone */
  status: number;
  /** Worth offering 在 GitHub 网页上提交 instead (the in-app route cannot work for this user/repo) */
  webFallback: boolean;
  constructor(status: number, message: string, webFallback = false) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.webFallback = webFallback;
  }
}

/** The message the UI shows for a failed GitHub API response. */
export function describeFailure(
  status: number,
  { repo, detail, rateLimited = false, web = false }: { repo?: string; detail?: string; rateLimited?: boolean; /** the token came from the web login */ web?: boolean } = {},
): string {
  const what = detail ? `（${detail}）` : "";
  const where = repo ?? "仓库";
  switch (true) {
    case status === 401:
      return "GitHub 返回 401：登录已过期，请重新登录";
    case status === 403 && rateLimited:
      return "GitHub 返回 403：请求太频繁，稍后再试";
    // the web login asks for the identity only: its token opens no issue, App installed or not
    case (status === 403 || status === 404) && web:
      return `GitHub 返回 ${status}：这次登录的授权不能在 ${where} 上开 issue（网页登录只确认身份，没有开 issue 的权限）${what}。可以改在 GitHub 网页上提交`;
    case status === 403:
      return `GitHub 返回 403：你的账号不能在 ${where} 上开 issue（hebi8/market 的 GitHub App 没装在这个仓库，或账号被仓库限制）${what}。可以改在 GitHub 网页上提交`;
    case status === 404:
      return `GitHub 返回 404：找不到 ${where}，或者 hebi8/market 的 GitHub App 没有安装到这个仓库。可以改在 GitHub 网页上提交`;
    case status === 410:
      return `GitHub 返回 410：${where} 关闭了 issue`;
    case status === 422:
      return `GitHub 返回 422：内容没通过校验${what}`;
    case status >= 500:
      return `GitHub 返回 ${status}：GitHub 暂时不可用，稍后再试`;
    default:
      return `GitHub 返回 ${status}${what}`;
  }
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new GitHubError(0, `连不上 GitHub：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** REST API call; non-2xx throws `GitHubError`. `repo` and `web` only flavour the error messages. */
export async function api<T>(
  path: string,
  { method = "GET", token, body, repo, web }: { method?: string; token?: string | null; body?: unknown; repo?: string; web?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hebi8-market",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await send(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = (json as { message?: string; errors?: { message?: string; field?: string; code?: string }[] } | null) ?? null;
    const first = detail?.errors?.[0];
    const message = [detail?.message, first?.message ?? (first ? `${first.field ?? ""} ${first.code ?? ""}`.trim() : null)].filter(Boolean).join(" · ");
    const rateLimited = res.headers.get("x-ratelimit-remaining") === "0";
    throw new GitHubError(res.status, describeFailure(res.status, { repo, detail: message || undefined, rateLimited, web }), !rateLimited && [403, 404, 410].includes(res.status));
  }
  return json as T;
}

// ---------------------------------------------------------------------------- request helpers

const HOST_RE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** The request came over HTTPS: through the Cloudflare tunnel, which says so in `X-Forwarded-Proto`. */
export const isHttps = (headers: Headers) => headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";

/** `http(s)://host[:port]` of the request, from `Host` and `X-Forwarded-Proto` (default http). */
export function requestOrigin(headers: Headers): string {
  const host = headers.get("host") ?? "";
  if (!HOST_RE.test(host)) throw new Error(`请求的 Host 不合法：${host.slice(0, 80)}`);
  return `${isHttps(headers) ? "https" : "http"}://${host}`;
}

/** A browser POST from another site (the session cookie is SameSite=Lax, this is belt and braces). */
export function crossSite(headers: Headers): boolean {
  const from = headers.get("origin");
  if (!from) return false;
  try {
    return from !== requestOrigin(headers);
  } catch {
    return true;
  }
}

/** `Secure` over HTTPS only: the tailnet is plain http and has to keep its login. */
export const SESSION_COOKIE = "hebi8m_session";
export const cookieOptions = (maxAgeSec: number, headers: Headers) => ({ httpOnly: true, sameSite: "lax" as const, secure: isHttps(headers), path: "/", maxAge: maxAgeSec });

export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url");

/** Constant-time comparison of two secrets. */
export function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Where a login returns to: a path on this site only, else the overview. One leading `/` (browsers
 * read `/\` as `//`), and still so once the dot segments are resolved (`/..//host` is `//host`).
 */
export function safeNext(next: string | null | undefined): string {
  // no control characters either: URL parsers drop tabs and newlines, so `/\t/host` is `//host`
  if (!next || next.length > 1000 || !/^\/(?![/\\])[^\\\x00-\x1f]*$/.test(next)) return "/";
  const url = new URL(next, "http://localhost");
  return url.pathname.startsWith("//") ? "/" : `${url.pathname}${url.search}${url.hash}`;
}

// ---------------------------------------------------------------------------- OAuth endpoints

export interface UserTokens {
  access_token: string;
  access_expires_at: number | null;
  refresh_token: string | null;
  refresh_expires_at: number | null;
}

interface OAuthReply {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  interval?: number;
  error?: string;
  error_description?: string;
}

/** POST a form to github.com/login/…; GitHub reports OAuth errors as 200 (sometimes 4xx) + `error`. */
async function oauthPost<T extends { error?: string; error_description?: string }>(path: string, params: Record<string, string>): Promise<{ status: number; json: T | null }> {
  const res = await send(`${WEB}${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "hebi8-market" },
    body: new URLSearchParams(params).toString(),
  });
  const json = (await res.json().catch(() => null)) as T | null;
  // a known OAuth error is the caller's to interpret (slow_down etc. may come with a 4xx)
  if (!res.ok && !(json?.error && json.error in OAUTH_ERRORS) && !(json?.error && DEVICE_STATES.has(json.error))) {
    throw new GitHubError(res.status, res.status === 404 ? UNKNOWN_CLIENT : describeFailure(res.status));
  }
  return { status: res.status, json };
}

const UNKNOWN_CLIENT = "GitHub 不认识这个 client id（检查 app-info.ts 的 GITHUB_APP_CLIENT_ID 或 HEBI8_GITHUB_CLIENT_ID；网页登录检查 github-oauth.json）";
const DEVICE_STATES = new Set(["authorization_pending", "slow_down", "expired_token", "access_denied"]);

const OAUTH_ERRORS: Record<string, [number, string]> = {
  device_flow_disabled: [400, "GitHub App 没有开启 Device Flow（App 设置 → 勾选 Enable Device Flow）"],
  incorrect_client_credentials: [400, UNKNOWN_CLIENT],
  bad_refresh_token: [401, "GitHub 返回 401：登录已过期，请重新登录"],
  unverified_user_email: [403, "GitHub 账号的邮箱还没验证"],
  incorrect_device_code: [400, "登录代码无效，请重新登录"],
  bad_verification_code: [400, "GitHub 的授权码无效或已过期，请重新登录"],
  redirect_uri_mismatch: [400, "回调地址和 GitHub 上登记的不一致（github-oauth.json 的 origins 和 App 的 callback URL）"],
  unsupported_grant_type: [400, "GitHub 不接受这种登录方式"],
};

const oauthFailure = (reply: { error?: string; error_description?: string } | null) => {
  const known = reply?.error ? OAUTH_ERRORS[reply.error] : undefined;
  if (known) return new GitHubError(known[0], known[1]);
  return new GitHubError(400, `GitHub 登录失败：${reply?.error_description ?? reply?.error ?? "没有返回 token"}`);
};

function tokensFrom(json: OAuthReply, now: number): UserTokens {
  return {
    access_token: json.access_token!,
    access_expires_at: json.expires_in ? now + Number(json.expires_in) * 1000 : null,
    refresh_token: json.refresh_token ?? null,
    refresh_expires_at: json.refresh_token_expires_in ? now + Number(json.refresh_token_expires_in) * 1000 : null,
  };
}

// ---------------------------------------------------------------------------- web login

const OAUTH_FILE = "github-oauth.json";
/** The pending web login: state, PKCE verifier and where to return, for the 10 minutes GitHub gives a code. */
export const LOGIN_COOKIE = "hebi8m_login";
export const LOGIN_MINUTES = 10;

/**
 * The client of the web login, an OAuth App or a GitHub App alike (same endpoints; a GitHub App's
 * reply just adds an expiry and a refresh token).
 */
export interface WebClient {
  clientId: string;
  clientSecret: string;
  /** Passed to GitHub as is; empty = the identity only */
  scope: string;
  /** The origins whose `/api/github/callback` is registered with the client */
  origins: string[];
}

/** `github-oauth.json` in the secrets dir, read on every use; null unless it has both the id and the secret. */
export function webClient(): WebClient | null {
  const file = readJson<{ client_id?: unknown; client_secret?: unknown; scope?: unknown; origins?: unknown }>(OAUTH_FILE);
  if (typeof file?.client_id !== "string" || !file.client_id || typeof file.client_secret !== "string" || !file.client_secret) return null;
  return {
    clientId: file.client_id,
    clientSecret: file.client_secret,
    scope: typeof file.scope === "string" ? file.scope : "",
    origins: Array.isArray(file.origins) ? file.origins.filter((o): o is string => typeof o === "string").map((o) => o.replace(/\/+$/, "")) : [publicUrl()],
  };
}

/**
 * The web login's client when this request may use it: GitHub only redirects back to a registered
 * callback, so a login started on any other origin (the tailnet's http address) would land its
 * cookie on the wrong host. Null there, and those origins keep the device flow.
 */
export function webLoginClient(headers: Headers): WebClient | null {
  const client = githubClientId() ? webClient() : null;
  if (!client) return null;
  try {
    return client.origins.includes(requestOrigin(headers)) ? client : null;
  } catch {
    return null;
  }
}

/** github.com's authorization page for this login. PKCE (S256) rides along; a client that ignores it loses nothing. */
export function authorizeUrl(client: WebClient, { redirectUri, state, verifier }: { redirectUri: string; state: string; verifier: string }): string {
  const url = new URL(`${WEB}/login/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirectUri,
    state,
    scope: client.scope,
    code_challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

/** Trade the code GitHub sent to the callback for the user's tokens. */
export async function exchangeCode(client: WebClient, { code, redirectUri, verifier }: { code: string; redirectUri: string; verifier: string }, now = Date.now()): Promise<UserTokens> {
  const { json } = await oauthPost<OAuthReply>("/login/oauth/access_token", {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  });
  if (!json?.access_token) throw oauthFailure(json);
  return tokensFrom(json, now);
}

/** How a web login ended, told to the page it returns to in `?login=` (the page shows it once and drops the parameter). */
export type LoginNotice = "ok" | "denied" | "state" | "failed" | "unavailable";

export function loginNotice(next: string, notice: LoginNotice): string {
  const url = new URL(next, "http://localhost");
  url.searchParams.set("login", notice);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ---------------------------------------------------------------------------- device flow

/** A login waiting for the user to enter the code on github.com. Kept in memory only. */
interface PendingFlow {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** seconds between polls, as GitHub demands (grows by 5 on `slow_down`) */
  interval: number;
  /** ms; no GitHub poll before this */
  nextPollAt: number;
  /** ms */
  expiresAt: number;
}

const g = globalThis as unknown as { hebi8DeviceFlows?: Map<string, PendingFlow>; hebi8RecentIssues?: Map<string, { at: number; issues: IssueSummary[] }> };
const flows = (g.hebi8DeviceFlows ??= new Map());
const recentCache = (g.hebi8RecentIssues ??= new Map());

/** At most this many logins pending at once (each is one person in front of github.com/login/device). */
const MAX_FLOWS = 20;

/** Forget pending logins and the cached issue list (tests). */
export function resetGitHubCaches(): void {
  flows.clear();
  recentCache.clear();
}

function pruneFlows(now: number): void {
  for (const [id, f] of flows) if (f.expiresAt <= now) flows.delete(id);
}

export interface DeviceStart {
  flowId: string;
  user_code: string;
  verification_uri: string;
  /** seconds */
  expires_in: number;
  /** seconds */
  interval: number;
}

/** Ask GitHub for a user code; the device code stays here, the browser gets a random flow id. */
export async function startDeviceFlow(clientId: string, now = Date.now()): Promise<DeviceStart> {
  if (!clientId) throw new GitHubError(400, "反馈未启用：没有配置 GitHub App 的 client id");
  pruneFlows(now);
  if (flows.size >= MAX_FLOWS) throw new GitHubError(429, "同时进行的登录太多，稍后再试");
  const { json } = await oauthPost<{ device_code?: string; user_code?: string; verification_uri?: string; expires_in?: number; interval?: number; error?: string; error_description?: string }>(
    "/login/device/code",
    { client_id: clientId },
  );
  if (!json?.device_code || !json.user_code) throw oauthFailure(json);
  // only ever send people to github.com
  const verificationUri = typeof json.verification_uri === "string" && json.verification_uri.startsWith(`${WEB}/`) ? json.verification_uri : `${WEB}/login/device`;
  const interval = Math.max(1, Number(json.interval) || 5);
  const expiresIn = Math.max(1, Number(json.expires_in) || 900);
  const flowId = randomToken(32);
  flows.set(flowId, { clientId, deviceCode: json.device_code, userCode: json.user_code, verificationUri, interval, nextPollAt: now + interval * 1000, expiresAt: now + expiresIn * 1000 });
  return { flowId, user_code: json.user_code, verification_uri: verificationUri, expires_in: expiresIn, interval };
}

export type DevicePoll =
  | { status: "pending"; interval: number; slowDown?: boolean }
  | { status: "expired" }
  | { status: "denied" }
  | { status: "done"; tokens: UserTokens };

/**
 * One step of the login: at most one GitHub poll per call and never before the interval GitHub
 * asked for (an early call just answers `pending`). `authorization_pending` waits, `slow_down`
 * adds 5 seconds, `expired_token` / `access_denied` end the flow.
 */
export async function pollDeviceFlow(flowId: string, now = Date.now()): Promise<DevicePoll> {
  const flow = typeof flowId === "string" ? flows.get(flowId) : undefined;
  if (!flow || flow.expiresAt <= now) {
    if (flow) flows.delete(flowId);
    return { status: "expired" };
  }
  if (now < flow.nextPollAt) return { status: "pending", interval: flow.interval };
  // reserve the slot before awaiting so concurrent calls do not poll twice
  flow.nextPollAt = now + flow.interval * 1000;
  let json: OAuthReply | null;
  try {
    ({ json } = await oauthPost<OAuthReply>("/login/oauth/access_token", {
      client_id: flow.clientId,
      device_code: flow.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }));
  } catch (err) {
    // network trouble: keep the flow, try again next interval
    if (err instanceof GitHubError && err.status === 0) return { status: "pending", interval: flow.interval };
    flows.delete(flowId);
    throw err;
  }
  if (json?.access_token) {
    flows.delete(flowId);
    return { status: "done", tokens: tokensFrom(json, now) };
  }
  switch (json?.error) {
    case "authorization_pending":
      return { status: "pending", interval: flow.interval };
    case "slow_down":
      flow.interval = Math.max(flow.interval + 5, Number(json.interval) || 0);
      flow.nextPollAt = now + flow.interval * 1000;
      return { status: "pending", interval: flow.interval, slowDown: true };
    case "expired_token":
      flows.delete(flowId);
      return { status: "expired" };
    case "access_denied":
      flows.delete(flowId);
      return { status: "denied" };
    default:
      flows.delete(flowId);
      throw oauthFailure(json);
  }
}

/** 取消: forget the pending login. */
export function cancelDeviceFlow(flowId: unknown): void {
  if (typeof flowId === "string") flows.delete(flowId);
}

// ---------------------------------------------------------------------------- user token

export function getUser(token: string): Promise<{ login: string; avatar_url: string }> {
  return api<{ login: string; avatar_url: string }>("/user", { token });
}

/** Device-flow tokens refresh with the client id alone; the web login's need its client secret too. */
export async function refreshUserToken(clientId: string, clientSecret: string | null, refreshToken: string, now = Date.now()): Promise<UserTokens> {
  const { json } = await oauthPost<OAuthReply>("/login/oauth/access_token", {
    client_id: clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  if (!json?.access_token) throw oauthFailure(json);
  return tokensFrom(json, now);
}

/** Refresh this long before the 8-hour user token actually expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * The session's user token, refreshed when (nearly) expired; 401 when the login cannot be kept.
 * The client that issued the tokens renews them: the web login's (`session.web_client`) with its
 * secret, the device flow's (`clientId`) without.
 */
export async function userToken(clientId: string, sessionId: string | undefined): Promise<{ token: string; session: Session }> {
  const session = getSession(sessionId);
  if (!session || !sessionId) throw new GitHubError(401, "还没有登录 GitHub");
  if (!session.access_token) throw new GitHubError(403, "这台设备的登录是从其他设备带过来的，没有 GitHub 的授权：用 GitHub 登录一次才能在应用里提交。也可以改在 GitHub 网页上提交", true);
  if (!session.access_expires_at || session.access_expires_at - REFRESH_MARGIN_MS > Date.now()) return { token: session.access_token, session };
  if (!session.refresh_token || (session.refresh_expires_at && session.refresh_expires_at < Date.now())) {
    throw new GitHubError(401, "GitHub 返回 401：登录已过期，请重新登录");
  }
  const web = session.web_client ? webClient() : null;
  // the web login's client was replaced or removed: nothing can renew its tokens
  if (session.web_client && web?.clientId !== session.web_client) throw new GitHubError(401, "登录已过期，请重新登录");
  let next: UserTokens;
  try {
    next = await refreshUserToken(web?.clientId ?? clientId, web?.clientSecret ?? null, session.refresh_token);
  } catch (err) {
    // anything but a network hiccup means this login is over
    if (err instanceof GitHubError && err.status === 0) throw err;
    throw new GitHubError(401, "登录已过期，请重新登录");
  }
  updateSession(sessionId, next);
  return { token: next.access_token, session: { ...session, ...next } };
}

// ---------------------------------------------------------------------------- issues

export interface CreatedIssue {
  number: number;
  html_url: string;
  title: string;
}

/** Open the issue as the logged-in user (they are the author). No labels: the repo's workflow adds them. */
export function createIssue(token: string, repo: string, issue: { title: string; body: string }, web = false): Promise<CreatedIssue> {
  return api<CreatedIssue>(`/repos/${repo}/issues`, { method: "POST", token, body: { title: issue.title, body: issue.body }, repo, web });
}

export interface IssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  created_at: string;
}

const RECENT_TTL_MS = 60 * 1000;

/**
 * The latest in-app reports, newest first, pull requests excluded; with the user's token when
 * there is one (higher rate limit), else anonymously (public repo). Cached 60 s per repo.
 */
export async function recentFromAppIssues(repo: string, token: string | null, count = 5, now = Date.now()): Promise<IssueSummary[]> {
  const hit = recentCache.get(repo);
  if (hit && now - hit.at < RECENT_TTL_MS) return hit.issues;
  const path = `/repos/${repo}/issues?labels=${encodeURIComponent(FROM_APP_LABEL)}&state=all&sort=created&direction=desc&per_page=${count + 5}`;
  let list: (IssueSummary & { pull_request?: unknown })[];
  try {
    list = await api(path, { token, repo });
  } catch (err) {
    // a user token the App cannot use here: the list is public anyway
    if (!token || !(err instanceof GitHubError) || err.status === 0) throw err;
    list = await api(path, { repo });
  }
  const issues = list
    .filter((i) => !i.pull_request)
    .slice(0, count)
    .map(({ number, title, state, html_url, created_at }) => ({ number, title, state, html_url, created_at }));
  recentCache.set(repo, { at: now, issues });
  return issues;
}

/** A new issue makes the cached list stale. */
export function forgetRecentIssues(repo: string): void {
  recentCache.delete(repo);
}
