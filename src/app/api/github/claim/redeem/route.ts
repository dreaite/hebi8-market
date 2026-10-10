import { NextResponse, type NextRequest } from "next/server";
import { takeClaim } from "@/lib/claim";
import { SESSION_COOKIE, cookieOptions, crossSite, loginNotice } from "@/lib/github";
import { SESSION_DAYS, createSession, deleteSession } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * 在其他设备上登录, the 登录 button on `/claim` (a plain form post): the code is used up and this
 * browser gets a session of its own for that person. No GitHub tokens come along: a GitHub App's
 * refresh token is replaced on every use, so two sessions sharing one would cancel each other.
 * A code that is gone goes back to `/claim`, which says so.
 */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const code = (await request.formData().catch(() => null))?.get("c");
  const claim = takeClaim(typeof code === "string" ? code : undefined);
  if (!claim) return new NextResponse(null, { status: 303, headers: { Location: "/claim", "Cache-Control": "no-store" } });
  // a login replaces whatever this browser was logged in as
  deleteSession(request.cookies.get(SESSION_COOKIE)?.value);
  const sessionId = createSession({ login: claim.login, avatar_url: claim.avatarUrl, access_token: null, access_expires_at: null, refresh_token: null, refresh_expires_at: null });
  const res = new NextResponse(null, { status: 303, headers: { Location: loginNotice("/", "ok"), "Cache-Control": "no-store" } });
  res.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(SESSION_DAYS * 86400, request.headers));
  return res;
}
