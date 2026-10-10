import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_COOKIE, SESSION_COOKIE, cookieOptions, exchangeCode, getUser, loginNotice, requestOrigin, safeNext, sameToken, webLoginClient, type LoginNotice } from "@/lib/github";
import { SESSION_DAYS, createSession, deleteSession } from "@/lib/secrets";

export const dynamic = "force-dynamic";

function pendingLogin(cookie: string | undefined): { state: string; verifier: string; next: string } | null {
  try {
    const { state, verifier, next } = JSON.parse(cookie ?? "") as Record<string, unknown>;
    return typeof state === "string" && state && typeof verifier === "string" ? { state, verifier, next: safeNext(typeof next === "string" ? next : null) } : null;
  } catch {
    return null;
  }
}

/**
 * 登录, back from github.com: the state must be the one in this browser's cookie, then the code is
 * traded for the user's tokens (client secret and PKCE verifier, server side) and a session opens.
 * Every way out returns to the page the login started on; a failure says why in `?login=`.
 */
export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const pending = pendingLogin(request.cookies.get(LOGIN_COOKIE)?.value);
  const back = (notice: LoginNotice) => {
    const res = new NextResponse(null, { status: 303, headers: { Location: loginNotice(pending?.next ?? "/", notice), "Cache-Control": "no-store" } });
    res.cookies.delete(LOGIN_COOKIE);
    return res;
  };
  if (!pending || !sameToken(query.get("state") ?? "", pending.state)) return back("state");
  if (query.has("error")) return back(query.get("error") === "access_denied" ? "denied" : "failed");
  const client = webLoginClient(request.headers);
  if (!client) return back("unavailable");
  try {
    const tokens = await exchangeCode(client, { code: query.get("code") ?? "", redirectUri: `${requestOrigin(request.headers)}/api/github/callback`, verifier: pending.verifier });
    const user = await getUser(tokens.access_token);
    // a login replaces whatever this browser was logged in as
    deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
    const sessionId = createSession({ login: user.login, avatar_url: user.avatar_url, ...tokens, web_client: client.clientId });
    const res = back("ok");
    res.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(SESSION_DAYS * 86400, request.headers));
    return res;
  } catch (err) {
    console.warn(`[hebi8m] web login failed: ${err instanceof Error ? err.message : String(err)}`);
    return back("failed");
  }
}
