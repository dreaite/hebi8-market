import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as callbackGET } from "@/app/api/github/callback/route";
import { GET as issuesGET, POST as issuesPOST } from "@/app/api/github/issues/route";
import { GET as loginGET } from "@/app/api/github/login/route";
import { POST as logoutPOST } from "@/app/api/github/logout/route";
import { GET as manifestGET } from "@/app/api/github/manifest/route";
import { GET as setupGET } from "@/app/api/github/setup/route";
import { buildIssueBody, feedbackLabels, parseFeedbackInput, parseIssueContext, type FeedbackContext } from "@/lib/feedback";
import {
  COOKIES,
  GitHubError,
  appJwt,
  buildManifest,
  callbackUrlsFor,
  resetGitHubCaches,
  decodeCookie,
  encodeCookie,
  manifestFormAction,
  normalizeCallbackUrls,
  requestOrigin,
  sanitizeReturn,
  userToken,
  withHelp,
  type OAuthCookie,
} from "@/lib/github";
import { createSession, getSession, readApp, writeApp, type GitHubAppCredentials } from "@/lib/secrets";

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const ORIGIN = "http://100.92.194.31:8809";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("appJwt", () => {
  it("is an RS256 JWT backdated 60s, valid 9 minutes, verifiable with the public key", () => {
    const jwt = appJwt("Iv1.abc", PEM, 1_700_000_000);
    const [h, p, sig] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(p)).toEqual({ iat: 1_700_000_000 - 60, exp: 1_700_000_000 + 540, iss: "Iv1.abc" });
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig, "base64url"))).toBe(true);
    expect(crypto.verify("RSA-SHA256", Buffer.from(`${h}.${p}x`), publicKey, Buffer.from(sig, "base64url"))).toBe(false);
  });
});

describe("issue body and labels", () => {
  const ctx: FeedbackContext = {
    v: 1,
    type: "data",
    app: { version: "0.1.0", commit: "abc1234", builtAt: null },
    page: "/chart/yahoo%3ASPY",
    chart: { symbol: "yahoo:SPY", tf: "W", style: "candle_solid", log: true, prices: "split", indicators: ["MA"], compares: [{ key: "yahoo:QQQ", mode: "percent" }] },
    viewport: { width: 1440, height: 900, dpr: 1 },
    colorScheme: "dark",
    fullscreen: false,
    userAgent: "test",
    errors: [{ t: "2026-10-06T00:00:00.000Z", kind: "error", message: "TypeError: x", source: "/_next/a.js:1:2" }],
    at: "2026-10-06T00:00:00.000Z",
  };

  it("puts the description first, then the context block in a details, then the footer", () => {
    const body = buildIssueBody("  周线不对  ", ctx);
    expect(body.startsWith("周线不对\n\n---\n\n<details><summary>页面信息</summary>\n\n```json hebi8-context\n{")).toBe(true);
    expect(body.endsWith("```\n</details>\n\n<sub>来自 hebi8 market 应用内反馈</sub>\n")).toBe(true);
    expect(parseIssueContext(body)).toEqual(ctx);
  });

  it("leaves the context out when not attached", () => {
    const body = buildIssueBody("", null);
    expect(body).toBe("（没有描述）\n\n<sub>来自 hebi8 market 应用内反馈</sub>\n");
    expect(parseIssueContext(body)).toBeNull();
  });

  it("labels: from-app, the type, optionally auto-fix-ok", () => {
    expect(feedbackLabels("bug", false)).toEqual(["from-app", "bug"]);
    expect(feedbackLabels("idea", true)).toEqual(["from-app", "idea", "auto-fix-ok"]);
  });

  it("validates submissions and stamps the type into the context", () => {
    expect(() => parseFeedbackInput({ type: "bug", title: "  " })).toThrow("标题不能为空");
    expect(() => parseFeedbackInput({ type: "nope", title: "x" })).toThrow("反馈类型不对");
    const input = parseFeedbackInput({ type: "ux", title: " 慢 ", description: "d", context: { ...ctx, type: "bug" }, autoFix: true });
    expect(input).toMatchObject({ type: "ux", title: "慢", autoFix: true });
    expect(input.context?.type).toBe("ux");
  });
});

describe("return paths and origins", () => {
  it("keeps same-origin relative paths only", () => {
    expect(sanitizeReturn("/chart/yahoo%3ASPY?x=1#a")).toBe("/chart/yahoo%3ASPY?x=1#a");
    expect(sanitizeReturn("/review")).toBe("/review");
    for (const bad of [null, "", "https://evil.example/", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "review", "/a\nb"]) {
      expect(sanitizeReturn(bad)).toBe("/");
    }
  });

  it("adds help=feedback (and extras) to the return path", () => {
    expect(withHelp("/chart/x?tf=W")).toBe("/chart/x?tf=W&help=feedback");
    expect(withHelp("//evil", { error: "坏了" })).toBe(`/?help=feedback&error=${encodeURIComponent("坏了")}`);
  });

  it("derives the origin from Host and X-Forwarded-Proto", () => {
    expect(requestOrigin(new Headers({ host: "100.92.194.31:8809" }))).toBe(ORIGIN);
    expect(requestOrigin(new Headers({ host: "a.ts.net", "x-forwarded-proto": "https" }))).toBe("https://a.ts.net");
    expect(() => requestOrigin(new Headers({ host: "evil/<x>" }))).toThrow();
  });
});

describe("manifest", () => {
  it("puts the current origin first among the callback URLs, deduplicated, at most 10", () => {
    const urls = callbackUrlsFor("http://100.92.194.31:8809", ["http://100.92.194.31:8808", "http://100.92.194.31:8809"]);
    expect(urls).toEqual(["http://100.92.194.31:8809/api/github/callback", "http://100.92.194.31:8808/api/github/callback"]);
    expect(callbackUrlsFor("http://a", Array.from({ length: 20 }, (_, i) => `http://h${i}`))).toHaveLength(10);
  });

  it("validates edited callback URLs", () => {
    expect(normalizeCallbackUrls(["", " http://a:1/api/github/callback ", "http://a:1/api/github/callback"])).toEqual(["http://a:1/api/github/callback"]);
    expect(() => normalizeCallbackUrls(["ftp://a/x"])).toThrow();
    expect(() => normalizeCallbackUrls(["http://a/x?y=1"])).toThrow();
    expect(() => normalizeCallbackUrls([])).toThrow();
    expect(() => normalizeCallbackUrls(Array.from({ length: 11 }, (_, i) => `http://h${i}/cb`))).toThrow();
  });

  it("asks for issues write + metadata read, no events, and points back at this origin", () => {
    const m = buildManifest({ origin: ORIGIN, callbackUrls: [`${ORIGIN}/api/github/callback`], suffix: "x1y2" });
    expect(m).toEqual({
      name: "hebi8-market-x1y2",
      url: "https://github.com/dreaite/hebi8-market",
      description: expect.any(String),
      hook_attributes: { url: `${ORIGIN}/api/github/webhook`, active: false },
      redirect_url: `${ORIGIN}/api/github/manifest`,
      callback_urls: [`${ORIGIN}/api/github/callback`],
      setup_url: `${ORIGIN}/api/github/setup`,
      setup_on_update: true,
      request_oauth_on_install: false,
      public: false,
      default_permissions: { issues: "write", metadata: "read" },
      default_events: [],
    });
    expect(buildManifest({ origin: ORIGIN, callbackUrls: [] }).name).toMatch(/^hebi8-market-[a-z0-9]{4}$/);
    expect(manifestFormAction("s t")).toBe("https://github.com/organizations/dreaite/settings/apps/new?state=s%20t");
  });
});

// ---------------------------------------------------------------------------- routes with a fake GitHub

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let routes: Record<string, Handler>;
let calls: { method: string; url: string; auth?: string; body?: unknown }[];
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "hebi8-secrets-"));
  process.env.HEBI8_SECRETS = path.join(dir, "secrets");
  resetGitHubCaches();
  routes = {};
  calls = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    calls.push({ method, url: url.toString(), auth: headers.get("authorization") ?? undefined, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const handler = routes[`${method} ${url.origin}${url.pathname}`];
    if (!handler) return json({ message: "Not Found" }, 404);
    return handler(url, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.HEBI8_SECRETS;
  fs.rmSync(dir, { recursive: true, force: true });
});

const req = (url: string, init: { method?: string; cookies?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {}) => {
  const headers = new Headers({ host: "100.92.194.31:8809", ...init.headers });
  if (init.cookies) headers.set("cookie", Object.entries(init.cookies).map(([k, v]) => `${k}=${v}`).join("; "));
  return new NextRequest(`${ORIGIN}${url}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
};

const APP: GitHubAppCredentials = {
  id: 42,
  slug: "hebi8-market-x1y2",
  client_id: "Iv1.client",
  client_secret: "secret",
  pem: PEM,
  webhook_secret: null,
  owner: "dreaite",
  html_url: "https://github.com/apps/hebi8-market-x1y2",
  callback_urls: [`${ORIGIN}/api/github/callback`],
  installation_id: null,
};

function installGitHub() {
  routes["GET https://api.github.com/app/installations/7"] = () => json({ id: 7, account: { login: "dreaite" } });
  routes["POST https://api.github.com/app/installations/7/access_tokens"] = () => json({ token: "ghs_inst", expires_at: new Date(Date.now() + 3600_000).toISOString() });
  routes["GET https://api.github.com/installation/repositories"] = () => json({ repositories: [{ full_name: "dreaite/hebi8-market" }] });
}

describe("GET /api/github/manifest", () => {
  it("rejects a state that does not match the cookie", async () => {
    const res = await manifestGET(req("/api/github/manifest?code=abc&state=wrong", { cookies: { [COOKIES.manifest]: encodeCookie({ state: "right", callbackUrls: [] }) } }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toMatch(/^http:\/\/100\.92\.194\.31:8809\/settings\/github\?error=/);
    expect(calls).toHaveLength(0);
    expect(readApp()).toBeNull();
  });

  it("converts the code, stores the credentials with mode 600 and goes to the install page", async () => {
    routes["POST https://api.github.com/app-manifests/abc/conversions"] = () =>
      json({ id: 42, slug: "hebi8-market-x1y2", client_id: "Iv1.client", client_secret: "secret", pem: PEM, webhook_secret: "wh", html_url: APP.html_url, owner: { login: "dreaite" } }, 201);
    const cookie = encodeCookie({ state: "right", callbackUrls: APP.callback_urls });
    const res = await manifestGET(req("/api/github/manifest?code=abc&state=right", { cookies: { [COOKIES.manifest]: cookie } }));
    expect(res.headers.get("location")).toBe("https://github.com/apps/hebi8-market-x1y2/installations/new");
    expect(readApp()).toMatchObject({ id: 42, client_id: "Iv1.client", callback_urls: APP.callback_urls, installation_id: null, owner: "dreaite" });
    const file = path.join(process.env.HEBI8_SECRETS!, "github-app.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.statSync(process.env.HEBI8_SECRETS!).mode & 0o777).toBe(0o700);
  });
});

describe("GET /api/github/setup", () => {
  it("verifies the installation with the App JWT before storing it", async () => {
    writeApp(APP);
    installGitHub();
    const res = await setupGET(req("/api/github/setup?installation_id=7&setup_action=install"));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/?help=feedback`);
    expect(readApp()?.installation_id).toBe(7);
    const jwt = calls.find((c) => c.url.endsWith("/app/installations/7"))!.auth!.slice("Bearer ".length);
    expect(decode(jwt.split(".")[1]).iss).toBe("Iv1.client");
  });

  it("refuses an installation that does not include the repo", async () => {
    writeApp(APP);
    installGitHub();
    routes["GET https://api.github.com/installation/repositories"] = () => json({ repositories: [{ full_name: "dreaite/other" }] });
    const res = await setupGET(req("/api/github/setup?installation_id=7"));
    expect(res.headers.get("location")).toContain("/settings/github?error=");
    expect(readApp()?.installation_id).toBeNull();
  });
});

describe("login", () => {
  it("redirects to GitHub with state + PKCE and remembers them in an HttpOnly cookie", async () => {
    writeApp({ ...APP, installation_id: 7 });
    const res = await loginGET(req(`/api/github/login?return=${encodeURIComponent("/chart/yahoo%3ASPY")}`));
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(location.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/api/github/callback`);
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).not.toMatch(/Secure/i);
    const saved = decodeCookie<OAuthCookie>(res.cookies.get(COOKIES.oauth)!.value);
    expect(saved.state).toBe(location.searchParams.get("state"));
    expect(crypto.createHash("sha256").update(saved.verifier!).digest("base64url")).toBe(location.searchParams.get("code_challenge"));
    expect(saved.returnTo).toBe("/chart/yahoo%3ASPY");
  });

  it("callback trades the code, opens a 30-day session and returns with ?help=feedback", async () => {
    writeApp({ ...APP, installation_id: 7 });
    routes["POST https://github.com/login/oauth/access_token"] = () =>
      json({ access_token: "ghu_a", expires_in: 28800, refresh_token: "ghr_r", refresh_token_expires_in: 15897600, token_type: "bearer", scope: "" });
    routes["GET https://api.github.com/user"] = () => json({ login: "dreaifekks", avatar_url: "https://avatars.githubusercontent.com/u/1" });
    const cookie = encodeCookie({ state: "st", verifier: "ver", returnTo: "/review", redirectUri: `${ORIGIN}/api/github/callback` } satisfies OAuthCookie);
    const res = await callbackGET(req("/api/github/callback?code=c0de&state=st", { cookies: { [COOKIES.oauth]: cookie } }));
    expect(res.headers.get("location")).toBe(`${ORIGIN}/review?help=feedback`);
    const exchange = calls.find((c) => c.url === "https://github.com/login/oauth/access_token")!;
    expect(exchange.body).toMatchObject({ client_id: "Iv1.client", code: "c0de", code_verifier: "ver", redirect_uri: `${ORIGIN}/api/github/callback` });
    const sessionId = res.cookies.get(COOKIES.session)!.value;
    expect(getSession(sessionId)).toMatchObject({ login: "dreaifekks", access_token: "ghu_a", refresh_token: "ghr_r" });
    expect(res.cookies.get(COOKIES.session)!.maxAge).toBe(30 * 86400);
  });

  it("callback with a mismatched state opens nothing", async () => {
    writeApp({ ...APP, installation_id: 7 });
    const cookie = encodeCookie({ state: "st", verifier: "ver", returnTo: "/", redirectUri: "x" });
    const res = await callbackGET(req("/api/github/callback?code=c&state=other", { cookies: { [COOKIES.oauth]: cookie } }));
    expect(res.headers.get("location")).toContain("help=feedback&error=");
    expect(res.cookies.get(COOKIES.session)).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("logout forgets the session", async () => {
    const id = createSession({ login: "u", avatar_url: "", access_token: "t", access_expires_at: null, refresh_token: null, refresh_expires_at: null });
    const res = await logoutPOST(req("/api/github/logout", { method: "POST", cookies: { [COOKIES.session]: id } }));
    expect(res.status).toBe(200);
    expect(getSession(id)).toBeNull();
  });
});

describe("user token refresh", () => {
  it("refreshes an expired token and stores the new pair", async () => {
    writeApp({ ...APP, installation_id: 7 });
    const id = createSession({ login: "u", avatar_url: "", access_token: "old", access_expires_at: Date.now() - 1000, refresh_token: "ghr_1", refresh_expires_at: Date.now() + 86400_000 });
    routes["POST https://github.com/login/oauth/access_token"] = () => json({ access_token: "new", expires_in: 28800, refresh_token: "ghr_2", refresh_token_expires_in: 15897600 });
    const { token } = await userToken(readApp()!, id);
    expect(token).toBe("new");
    expect(calls[0].body).toMatchObject({ grant_type: "refresh_token", refresh_token: "ghr_1", client_id: "Iv1.client" });
    expect(getSession(id)).toMatchObject({ access_token: "new", refresh_token: "ghr_2" });
  });

  it("a rejected refresh token means logging in again (401)", async () => {
    writeApp({ ...APP, installation_id: 7 });
    const id = createSession({ login: "u", avatar_url: "", access_token: "old", access_expires_at: Date.now() - 1000, refresh_token: "ghr_1", refresh_expires_at: Date.now() + 86400_000 });
    routes["POST https://github.com/login/oauth/access_token"] = () => json({ error: "bad_refresh_token", error_description: "The refresh token passed is incorrect or expired." });
    const err = await userToken(readApp()!, id).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.status).toBe(401);
    expect(err.message).toBe("GitHub 返回 401：登录已过期，请重新登录");
  });
});

describe("issues", () => {
  const submit = (cookies: Record<string, string>, body: unknown) => issuesPOST(req("/api/github/issues", { method: "POST", cookies, body, headers: { origin: ORIGIN } }));

  it("creates missing labels with the installation token, then the issue with the user token", async () => {
    writeApp({ ...APP, installation_id: 7 });
    installGitHub();
    const id = createSession({ login: "dreaifekks", avatar_url: "", access_token: "ghu_user", access_expires_at: Date.now() + 3600_000, refresh_token: null, refresh_expires_at: null });
    routes["GET https://api.github.com/repos/dreaite/hebi8-market/labels/bug"] = () => json({ name: "bug" });
    routes["POST https://api.github.com/repos/dreaite/hebi8-market/labels"] = () => json({}, 201);
    routes["POST https://api.github.com/repos/dreaite/hebi8-market/issues"] = () => json({ number: 123, html_url: "https://github.com/dreaite/hebi8-market/issues/123", title: "t" }, 201);

    const res = await submit({ [COOKIES.session]: id }, { type: "bug", title: "图表空白", description: "打开就空", context: null, autoFix: true });
    expect(await res.json()).toEqual({ number: 123, html_url: "https://github.com/dreaite/hebi8-market/issues/123" });

    const created = calls.filter((c) => c.method === "POST" && c.url.endsWith("/labels")).map((c) => (c.body as { name: string }).name);
    expect(created.sort()).toEqual(["auto-fix-ok", "from-app"]);
    expect(calls.filter((c) => c.url.endsWith("/labels")).every((c) => c.auth === "Bearer ghs_inst")).toBe(true);
    const issue = calls.find((c) => c.url.endsWith("/repos/dreaite/hebi8-market/issues") && c.method === "POST")!;
    expect(issue.auth).toBe("Bearer ghu_user");
    expect(issue.body).toEqual({ title: "图表空白", body: buildIssueBody("打开就空", null), labels: ["from-app", "bug", "auto-fix-ok"] });
  });

  it("still opens the issue when label creation fails", async () => {
    writeApp({ ...APP, installation_id: 7 });
    installGitHub();
    const id = createSession({ login: "u", avatar_url: "", access_token: "ghu_user", access_expires_at: null, refresh_token: null, refresh_expires_at: null });
    routes["POST https://api.github.com/repos/dreaite/hebi8-market/labels"] = () => json({ message: "Resource not accessible by integration" }, 403);
    routes["POST https://api.github.com/repos/dreaite/hebi8-market/issues"] = () => json({ number: 5, html_url: "u", title: "t" }, 201);
    const res = await submit({ [COOKIES.session]: id }, { type: "idea", title: "x" });
    expect(res.status).toBe(200);
    expect((await res.json()).number).toBe(5);
  });

  it("without a session answers 401 in Chinese; a cross-site POST is refused", async () => {
    writeApp({ ...APP, installation_id: 7 });
    const res = await submit({}, { type: "bug", title: "x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("还没有登录 GitHub");
    const cross = await issuesPOST(req("/api/github/issues", { method: "POST", body: { type: "bug", title: "x" }, headers: { origin: "http://evil.example" } }));
    expect(cross.status).toBe(403);
  });

  it("maps GitHub failures to Chinese messages", async () => {
    writeApp({ ...APP, installation_id: 7 });
    installGitHub();
    const id = createSession({ login: "u", avatar_url: "", access_token: "ghu_user", access_expires_at: null, refresh_token: null, refresh_expires_at: null });
    routes["GET https://api.github.com/repos/dreaite/hebi8-market/labels/from-app"] = () => json({});
    routes["GET https://api.github.com/repos/dreaite/hebi8-market/labels/bug"] = () => json({});
    routes["POST https://api.github.com/repos/dreaite/hebi8-market/issues"] = () => json({ message: "Bad credentials" }, 401);
    const res = await submit({ [COOKIES.session]: id }, { type: "bug", title: "x" });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("GitHub 返回 401：登录已过期，请重新登录");
    // the dead login is dropped so the panel offers 用 GitHub 登录 again
    expect(getSession(id)).toBeNull();
  });

  it("a 401 on the App's own credentials is not reported as an expired login", async () => {
    writeApp({ ...APP, installation_id: 7 });
    routes["POST https://api.github.com/app/installations/7/access_tokens"] = () => json({ message: "A JSON web token could not be decoded" }, 401);
    const res = await issuesGET();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toMatch(/^GitHub 返回 401：App 的凭据无效/);
  });

  it("lists the latest from-app issues without pull requests", async () => {
    writeApp({ ...APP, installation_id: 7 });
    installGitHub();
    routes["GET https://api.github.com/repos/dreaite/hebi8-market/issues"] = (url) => {
      expect(url.searchParams.get("labels")).toBe("from-app");
      expect(url.searchParams.get("state")).toBe("all");
      return json([
        { number: 3, title: "c", state: "open", html_url: "u3", created_at: "t", body: "secret-ish" },
        { number: 2, title: "pr", state: "open", html_url: "u2", created_at: "t", pull_request: {} },
        { number: 1, title: "a", state: "closed", html_url: "u1", created_at: "t" },
      ]);
    };
    const res = await issuesGET();
    expect(await res.json()).toEqual({
      issues: [
        { number: 3, title: "c", state: "open", html_url: "u3", created_at: "t" },
        { number: 1, title: "a", state: "closed", html_url: "u1", created_at: "t" },
      ],
    });
  });
});
