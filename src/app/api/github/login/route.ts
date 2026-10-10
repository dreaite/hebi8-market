import { NextResponse, type NextRequest } from "next/server";
import { LOGIN_COOKIE, LOGIN_MINUTES, authorizeUrl, cookieOptions, loginNotice, randomToken, requestOrigin, safeNext, webLoginClient } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * 登录, the web login: send the browser to github.com, which already knows who is logged in there
 * and comes back to `/api/github/callback`. The state and the PKCE verifier wait in a short-lived
 * HttpOnly cookie, with the page to return to. An origin without the web login goes nowhere.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const client = webLoginClient(request.headers);
  if (!client) return new NextResponse(null, { status: 303, headers: { Location: loginNotice(next, "unavailable"), "Cache-Control": "no-store" } });
  const state = randomToken(32);
  const verifier = randomToken(32);
  const redirectUri = `${requestOrigin(request.headers)}/api/github/callback`;
  const res = NextResponse.redirect(authorizeUrl(client, { redirectUri, state, verifier }), { status: 302, headers: { "Cache-Control": "no-store" } });
  res.cookies.set(LOGIN_COOKIE, JSON.stringify({ state, verifier, next }), cookieOptions(LOGIN_MINUTES * 60, request.headers));
  return res;
}
