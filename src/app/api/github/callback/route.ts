import { NextResponse, type NextRequest } from "next/server";
import { COOKIES, cookieOptions, decodeCookie, exchangeCode, getUser, requestOrigin, sameSecret, sanitizeReturn, withHelp, type OAuthCookie } from "@/lib/github";
import { SESSION_DAYS, createSession, readApp } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** GitHub's login callback: check state, trade the code (with the PKCE verifier), open a session. */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request.headers);
  const saved = decodeCookie<OAuthCookie>(request.cookies.get(COOKIES.oauth)?.value);
  const returnTo = sanitizeReturn(saved.returnTo);
  const finish = (extra: Record<string, string>, sessionId?: string) => {
    const res = NextResponse.redirect(new URL(withHelp(returnTo, extra), origin));
    res.cookies.delete(COOKIES.oauth);
    if (sessionId) res.cookies.set(COOKIES.session, sessionId, cookieOptions(SESSION_DAYS * 86400));
    return res;
  };
  const params = request.nextUrl.searchParams;
  if (params.get("error")) return finish({ error: `GitHub 登录取消或失败：${params.get("error_description") ?? params.get("error")}` });
  const code = params.get("code");
  if (!code || !sameSecret(params.get("state"), saved.state) || !saved.verifier || !saved.redirectUri) {
    return finish({ error: "登录状态不匹配（可能超时了），请重新点「用 GitHub 登录」" });
  }
  const app = readApp();
  if (!app) return finish({ error: "还没有配置 GitHub App" });
  try {
    const tokens = await exchangeCode(app, code, saved.redirectUri, saved.verifier);
    const user = await getUser(tokens.access_token);
    return finish({}, createSession({ login: user.login, avatar_url: user.avatar_url, ...tokens }));
  } catch (err) {
    return finish({ error: err instanceof Error ? err.message : String(err) });
  }
}
