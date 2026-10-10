import { NextResponse, type NextRequest } from "next/server";
import { renderSVG } from "uqr";
import { CLAIM_SECONDS, createClaim, dropClaims } from "@/lib/claim";
import { isLogin } from "@/lib/config";
import { SESSION_COOKIE, crossSite, requestOrigin } from "@/lib/github";
import { getSession } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/** Whoever is logged in; a hand-edited session whose login is no GitHub login is nobody. */
function who(request: NextRequest): { login: string; avatarUrl: string } | null {
  const session = getSession(request.cookies.get(SESSION_COOKIE)?.value);
  return session && isLogin(session.login) ? { login: session.login, avatarUrl: session.avatar_url } : null;
}

/**
 * 在其他设备上登录: a one-time link to this origin's `/claim`, good for two minutes, and the same
 * link as a QR code (an SVG drawn here; nothing is asked of any other service). The link logs
 * nobody in by being opened: the other device has to confirm on the page.
 */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const user = who(request);
  if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const code = createClaim(user);
  if (!code) return NextResponse.json({ error: "同时进行的登录太多，稍后再试" }, { status: 429 });
  const url = `${requestOrigin(request.headers)}/claim?c=${code}`;
  return NextResponse.json({ url, qr: renderSVG(url, { border: 4 }), expires_in: CLAIM_SECONDS }, { headers: { "Cache-Control": "no-store" } });
}

/** 关闭: the link stops working. */
export async function DELETE(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const user = who(request);
  if (user) dropClaims(user.login);
  return NextResponse.json({ ok: true });
}
