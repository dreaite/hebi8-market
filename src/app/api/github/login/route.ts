import { NextResponse, type NextRequest } from "next/server";
import { CALLBACK_PATH, COOKIES, authorizeUrl, cookieOptions, encodeCookie, pkcePair, randomToken, requestOrigin, sanitizeReturn, type OAuthCookie } from "@/lib/github";
import { readApp } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** Start "用 GitHub 登录": remember state, PKCE verifier and where to come back, then go to GitHub. */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request.headers);
  const returnTo = sanitizeReturn(request.nextUrl.searchParams.get("return"));
  const app = readApp();
  if (!app) return NextResponse.redirect(new URL("/settings/github", origin));
  const redirectUri = `${origin}${CALLBACK_PATH}`;
  const state = randomToken();
  const { verifier, challenge } = pkcePair();
  const res = NextResponse.redirect(authorizeUrl({ clientId: app.client_id, redirectUri, state, challenge }));
  const cookie: OAuthCookie = { state, verifier, returnTo, redirectUri };
  res.cookies.set(COOKIES.oauth, encodeCookie(cookie), cookieOptions(600));
  return res;
}
