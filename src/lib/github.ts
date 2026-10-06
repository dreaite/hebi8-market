/**
 * Every GitHub HTTP call goes through here: the App manifest flow, the App's JWT and installation
 * token, the user's OAuth login (with refresh) and the issues API. Failures become `GitHubError`
 * with a Chinese message the UI shows as is. Tokens never leave the server and are never logged.
 */
import crypto from "node:crypto";
import { DEFAULT_ORIGINS, FROM_APP_LABEL, REPO, REPO_FULL_NAME, REPO_URL } from "./app-info";
import { LABEL_SPECS } from "./feedback";
import { getSession, updateSession, type GitHubAppCredentials, type Session } from "./secrets";

const API = "https://api.github.com";
const WEB = "https://github.com";

export class GitHubError extends Error {
  /** HTTP status from GitHub, 0 when GitHub could not be reached, 401 when the login is gone */
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

/** The message the UI shows for a failed GitHub response. */
export function describeFailure(status: number, detail?: string, rateLimited = false, asApp = false): string {
  const what = detail ? `：${detail}` : "";
  switch (true) {
    case status === 401 && asApp:
      return "GitHub 返回 401：App 的凭据无效（App 被删除或私钥被吊销？重新配置 GitHub App）";
    case status === 401:
      return "GitHub 返回 401：登录已过期，请重新登录";
    case status === 403 && rateLimited:
      return "GitHub 返回 403：请求太频繁，稍后再试";
    case status === 403:
      return `GitHub 返回 403：没有权限（检查 App 的 Issues 权限和安装的仓库）${what}`;
    case status === 404:
      return `GitHub 返回 404：找不到（App 是否已安装到 ${REPO_FULL_NAME}？）`;
    case status === 422:
      return `GitHub 返回 422：内容没通过校验${what}`;
    case status >= 500:
      return `GitHub 返回 ${status}：GitHub 暂时不可用，稍后再试`;
    default:
      return `GitHub 返回 ${status}${what}`;
  }
}

interface CallOptions {
  method?: string;
  /** Bearer token: an installation token, a user token or the App JWT */
  token?: string;
  body?: unknown;
  /** The token is the App's (JWT or installation token), so a 401 is not about the user's login */
  asApp?: boolean;
}

async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch (err) {
    throw new GitHubError(0, `连不上 GitHub：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** REST API call; non-2xx throws `GitHubError`. */
export async function api<T>(path: string, { method = "GET", token, body, asApp = false }: CallOptions = {}): Promise<T> {
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
    throw new GitHubError(res.status, describeFailure(res.status, message || undefined, res.headers.get("x-ratelimit-remaining") === "0", asApp));
  }
  return json as T;
}

// ---------------------------------------------------------------------------- pure helpers

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** RS256 JWT that authenticates as the App: issued 60s in the past (clock drift), valid 9 minutes. */
export function appJwt(issuer: string | number, pem: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: nowSec - 60, exp: nowSec + 9 * 60, iss: String(issuer) }));
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pem);
  return `${header}.${payload}.${b64url(signature)}`;
}

export const randomToken = (bytes = 16) => crypto.randomBytes(bytes).toString("base64url");

/** PKCE (S256): the verifier stays in an HttpOnly cookie, the challenge goes to GitHub. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(32);
  return { verifier, challenge: crypto.createHash("sha256").update(verifier).digest("base64url") };
}

const HOST_RE = /^(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/** `http(s)://host[:port]` of the request, from `Host` and `X-Forwarded-Proto` (default http). */
export function requestOrigin(headers: Headers): string {
  const host = headers.get("host") ?? "";
  if (!HOST_RE.test(host)) throw new Error(`请求的 Host 不合法：${host.slice(0, 80)}`);
  const proto = headers.get("x-forwarded-proto")?.split(",")[0].trim();
  return `${proto === "https" ? "https" : "http"}://${host}`;
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

/** Origins this app is known to be served from: `HEBI8_ORIGINS` or the Tailscale defaults. */
export function knownOrigins(): string[] {
  const env = process.env.HEBI8_ORIGINS?.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
  return env?.length ? env : DEFAULT_ORIGINS;
}

export const CALLBACK_PATH = "/api/github/callback";
export const MAX_CALLBACK_URLS = 10;

/** Login callback URLs: the current origin first, then the other known ones; at most 10 (GitHub's limit). */
export function callbackUrlsFor(origin: string, others: string[] = knownOrigins()): string[] {
  return [...new Set([origin, ...others].map((o) => `${o}${CALLBACK_PATH}`))].slice(0, MAX_CALLBACK_URLS);
}

/** Keep only well-formed http(s) URLs, deduplicated, at most 10. */
export function normalizeCallbackUrls(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    let url: URL;
    try {
      url = new URL(s);
    } catch {
      throw new Error(`不是合法的网址：${s}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`只能用 http 或 https：${s}`);
    if (url.search || url.hash) throw new Error(`回调地址不能带参数：${s}`);
    if (!out.includes(url.href)) out.push(url.href);
  }
  if (out.length === 0) throw new Error("至少需要一个回调地址");
  if (out.length > MAX_CALLBACK_URLS) throw new Error(`GitHub 最多允许 ${MAX_CALLBACK_URLS} 个回调地址`);
  return out;
}

export interface AppManifest {
  name: string;
  url: string;
  description: string;
  hook_attributes: { url: string; active: boolean };
  redirect_url: string;
  callback_urls: string[];
  setup_url: string;
  setup_on_update: boolean;
  request_oauth_on_install: boolean;
  public: boolean;
  default_permissions: Record<string, "read" | "write">;
  default_events: string[];
}

/**
 * The manifest posted to github.com: issues write + metadata read on the one repo, no webhook
 * (GitHub wants a hook URL in the manifest, so it is given but left inactive).
 */
export function buildManifest({ origin, callbackUrls, suffix = randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "x") }: { origin: string; callbackUrls: string[]; suffix?: string }): AppManifest {
  return {
    name: `${REPO.name}-${suffix}`,
    url: REPO_URL,
    description: `hebi8 market 的应用内反馈：用你的 GitHub 账号在 ${REPO_FULL_NAME} 上提交 issue。`,
    hook_attributes: { url: `${origin}/api/github/webhook`, active: false },
    redirect_url: `${origin}/api/github/manifest`,
    callback_urls: callbackUrls,
    setup_url: `${origin}/api/github/setup`,
    setup_on_update: true,
    request_oauth_on_install: false,
    public: false,
    default_permissions: { issues: "write", metadata: "read" },
    default_events: [],
  };
}

export const manifestFormAction = (state: string) => `${WEB}/organizations/${REPO.owner}/settings/apps/new?state=${encodeURIComponent(state)}`;

/**
 * Where to send the browser after login: only same-origin relative paths survive, anything else
 * (absolute URLs, `//host`, backslashes, control characters) becomes `/`.
 */
export function sanitizeReturn(raw: string | null | undefined): string {
  if (!raw || raw.length > 1000 || !raw.startsWith("/") || raw.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(raw)) return "/";
  try {
    const base = "http://hebi8.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

/** `path` with `help=feedback` (and any extra params) so the help drawer opens on the 反馈 tab. */
export function withHelp(path: string, extra: Record<string, string> = {}): string {
  const url = new URL(sanitizeReturn(path), "http://hebi8.invalid");
  url.searchParams.set("help", "feedback");
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function authorizeUrl({ clientId, redirectUri, state, challenge }: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, state, code_challenge: challenge, code_challenge_method: "S256", allow_signup: "false" });
  return `${WEB}/login/oauth/authorize?${q}`;
}

// ---------------------------------------------------------------------------- cookies

/** No HTTPS on the tailnet, so never `Secure`; HttpOnly + SameSite=Lax survives GitHub's top-level redirects back. */
export const COOKIES = {
  /** state of the manifest flow (set by the settings page's server action) */
  manifest: "hebi8_gh_manifest",
  /** state + PKCE verifier + return path of a login */
  oauth: "hebi8_gh_oauth",
  session: "hebi8_session",
} as const;

export const cookieOptions = (maxAgeSec: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: false, path: "/", maxAge: maxAgeSec });

/** Small JSON payloads in a cookie (state, PKCE verifier, return path). */
export const encodeCookie = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

export function decodeCookie<T>(raw: string | undefined): Partial<T> {
  if (!raw) return {};
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return value && typeof value === "object" ? (value as Partial<T>) : {};
  } catch {
    return {};
  }
}

export interface ManifestCookie {
  state: string;
  callbackUrls: string[];
}

export interface OAuthCookie {
  state: string;
  verifier: string;
  returnTo: string;
  redirectUri: string;
}

/** Constant-time string comparison for state values. */
export function sameSecret(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------- the App

export interface ManifestConversion {
  id: number;
  slug: string;
  client_id: string;
  client_secret: string;
  pem: string;
  webhook_secret: string | null;
  html_url: string;
  owner: { login: string } | null;
}

/** Trade the one-hour code from the manifest redirect for the App's credentials. */
export async function convertManifest(code: string): Promise<ManifestConversion> {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(code)) throw new GitHubError(400, "manifest 回调的 code 不合法");
  return api<ManifestConversion>(`/app-manifests/${code}/conversions`, { method: "POST" });
}

const jwtFor = (app: GitHubAppCredentials) => appJwt(app.client_id || app.id, app.pem);

/** The installation must belong to the repo owner and include the repo; returns its id. */
export async function verifyInstallation(app: GitHubAppCredentials, installationId: number): Promise<number> {
  const inst = await api<{ id: number; account: { login: string } | null }>(`/app/installations/${installationId}`, { token: jwtFor(app), asApp: true });
  if (inst.account?.login.toLowerCase() !== REPO.owner.toLowerCase()) {
    throw new GitHubError(403, `这个安装属于 ${inst.account?.login ?? "未知账号"}，不是 ${REPO.owner}`);
  }
  const token = await installationToken({ ...app, installation_id: inst.id }, true);
  const repos = await api<{ repositories: { full_name: string }[] }>(`/installation/repositories?per_page=100`, { token, asApp: true });
  if (!repos.repositories.some((r) => r.full_name.toLowerCase() === REPO_FULL_NAME.toLowerCase())) {
    throw new GitHubError(403, `App 已安装，但没有选中 ${REPO_FULL_NAME}；在 GitHub 上把这个仓库加进安装范围`);
  }
  return inst.id;
}

/** Look the installation up from the repo (when the setup redirect never arrived). */
export async function findInstallation(app: GitHubAppCredentials): Promise<number> {
  const inst = await api<{ id: number }>(`/repos/${REPO_FULL_NAME}/installation`, { token: jwtFor(app), asApp: true });
  return verifyInstallation(app, inst.id);
}

const tokenCache = (globalThis as unknown as { hebi8InstallationTokens?: Map<number, { token: string; expiresAt: number }> }).hebi8InstallationTokens ??
  ((globalThis as unknown as { hebi8InstallationTokens: Map<number, { token: string; expiresAt: number }> }).hebi8InstallationTokens = new Map());

/** Installation access token, cached in memory until a minute before it expires. */
export async function installationToken(app: GitHubAppCredentials, fresh = false): Promise<string> {
  const id = app.installation_id;
  if (!id) throw new GitHubError(404, `App 还没有安装到 ${REPO_FULL_NAME}`);
  const hit = tokenCache.get(id);
  if (!fresh && hit && hit.expiresAt - 60000 > Date.now()) return hit.token;
  const res = await api<{ token: string; expires_at: string }>(`/app/installations/${id}/access_tokens`, { method: "POST", token: jwtFor(app), asApp: true });
  tokenCache.set(id, { token: res.token, expiresAt: Date.parse(res.expires_at) });
  return res.token;
}


// ---------------------------------------------------------------------------- user login

export interface UserTokens {
  access_token: string;
  access_expires_at: number | null;
  refresh_token: string | null;
  refresh_expires_at: number | null;
}

const OAUTH_ERRORS: Record<string, [number, string]> = {
  bad_verification_code: [400, "授权码已失效，请重新登录"],
  bad_refresh_token: [401, "GitHub 返回 401：登录已过期，请重新登录"],
  redirect_uri_mismatch: [400, "当前地址不在 App 的回调地址（Callback URL）里，在 GitHub App 设置里加上它"],
  incorrect_client_credentials: [401, "App 的 client secret 不对，重新配置 GitHub App"],
  unverified_user_email: [403, "GitHub 账号的邮箱还没验证"],
};

/** POST to github.com/login/oauth/access_token; errors there come back as 200 + `error`. */
async function oauthToken(params: Record<string, string>): Promise<UserTokens> {
  const res = await send(`${WEB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "hebi8-market" },
    body: JSON.stringify(params),
  });
  const json = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    refresh_token_expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;
  if (!res.ok) throw new GitHubError(res.status, describeFailure(res.status));
  if (!json?.access_token) {
    const known = json?.error ? OAUTH_ERRORS[json.error] : undefined;
    if (known) throw new GitHubError(known[0], known[1]);
    throw new GitHubError(400, `GitHub 登录失败：${json?.error_description ?? json?.error ?? "没有返回 token"}`);
  }
  const now = Date.now();
  return {
    access_token: json.access_token,
    access_expires_at: json.expires_in ? now + Number(json.expires_in) * 1000 : null,
    refresh_token: json.refresh_token ?? null,
    refresh_expires_at: json.refresh_token_expires_in ? now + Number(json.refresh_token_expires_in) * 1000 : null,
  };
}

export function exchangeCode(app: GitHubAppCredentials, code: string, redirectUri: string, verifier: string): Promise<UserTokens> {
  return oauthToken({ client_id: app.client_id, client_secret: app.client_secret, code, redirect_uri: redirectUri, code_verifier: verifier });
}

export function refreshUserToken(app: GitHubAppCredentials, refreshToken: string): Promise<UserTokens> {
  return oauthToken({ client_id: app.client_id, client_secret: app.client_secret, grant_type: "refresh_token", refresh_token: refreshToken });
}

export function getUser(token: string): Promise<{ login: string; avatar_url: string }> {
  return api<{ login: string; avatar_url: string }>("/user", { token });
}

/** Refresh this long before the 8-hour user token actually expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** The session's user token, refreshed when (nearly) expired; 401 when the login cannot be kept. */
export async function userToken(app: GitHubAppCredentials, sessionId: string | undefined): Promise<{ token: string; session: Session }> {
  const session = getSession(sessionId);
  if (!session || !sessionId) throw new GitHubError(401, "还没有登录 GitHub");
  if (!session.access_expires_at || session.access_expires_at - REFRESH_MARGIN_MS > Date.now()) return { token: session.access_token, session };
  if (!session.refresh_token || (session.refresh_expires_at && session.refresh_expires_at < Date.now())) {
    throw new GitHubError(401, "GitHub 返回 401：登录已过期，请重新登录");
  }
  const next = await refreshUserToken(app, session.refresh_token);
  updateSession(sessionId, next);
  return { token: next.access_token, session: { ...session, ...next } };
}

// ---------------------------------------------------------------------------- issues

const ensuredLabels = new Set<string>();

/** Forget cached installation tokens and known labels (tests; after reinstalling the App). */
export function resetGitHubCaches(): void {
  tokenCache.clear();
  ensuredLabels.clear();
}

/**
 * Create the custom labels the repo lacks (installation token). Best effort: returns the labels
 * known to exist afterwards and never throws, so a label problem cannot block the report.
 */
export async function ensureLabels(app: GitHubAppCredentials, names: string[]): Promise<string[]> {
  const ok: string[] = [];
  let token: string;
  try {
    token = await installationToken(app);
  } catch {
    return names.filter((n) => ensuredLabels.has(n));
  }
  for (const name of names) {
    if (ensuredLabels.has(name)) {
      ok.push(name);
      continue;
    }
    try {
      await api(`/repos/${REPO_FULL_NAME}/labels/${encodeURIComponent(name)}`, { token, asApp: true });
    } catch (err) {
      if (!(err instanceof GitHubError) || err.status !== 404) continue;
      const spec = LABEL_SPECS[name] ?? { color: "ededed", description: "" };
      try {
        await api(`/repos/${REPO_FULL_NAME}/labels`, { method: "POST", token, body: { name, ...spec }, asApp: true });
      } catch (createErr) {
        // 422 = someone created it in the meantime
        if (!(createErr instanceof GitHubError) || createErr.status !== 422) {
          console.warn(`[hebi8] could not create label ${name}: ${createErr instanceof Error ? createErr.message : createErr}`);
          continue;
        }
      }
    }
    ensuredLabels.add(name);
    ok.push(name);
  }
  return ok;
}

export interface CreatedIssue {
  number: number;
  html_url: string;
  title: string;
}

/**
 * Open the issue as the logged-in user (so the owner is the author). Labels that could not be
 * ensured are still sent; if GitHub rejects them the issue is created without labels.
 */
export async function createIssue(token: string, issue: { title: string; body: string; labels: string[] }): Promise<CreatedIssue> {
  const path = `/repos/${REPO_FULL_NAME}/issues`;
  try {
    return await api<CreatedIssue>(path, { method: "POST", token, body: issue });
  } catch (err) {
    if (err instanceof GitHubError && err.status === 422 && issue.labels.length) {
      return api<CreatedIssue>(path, { method: "POST", token, body: { title: issue.title, body: issue.body } });
    }
    throw err;
  }
}

export interface IssueSummary {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  created_at: string;
}

/** The latest in-app reports (installation token), newest first, pull requests excluded. */
export async function recentFromAppIssues(app: GitHubAppCredentials, count = 5): Promise<IssueSummary[]> {
  const token = await installationToken(app);
  const list = await api<(IssueSummary & { pull_request?: unknown })[]>(
    `/repos/${REPO_FULL_NAME}/issues?labels=${encodeURIComponent(FROM_APP_LABEL)}&state=all&sort=created&direction=desc&per_page=${count + 5}`,
    { token, asApp: true },
  );
  return list
    .filter((i) => !i.pull_request)
    .slice(0, count)
    .map(({ number, title, state, html_url, created_at }) => ({ number, title, state, html_url, created_at }));
}
