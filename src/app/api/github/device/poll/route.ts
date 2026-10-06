import { NextResponse, type NextRequest } from "next/server";
import { GitHubError, SESSION_COOKIE, cookieOptions, crossSite, getUser, pollDeviceFlow } from "@/lib/github";
import { SESSION_DAYS, createSession } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * 用 GitHub 登录, step 2, called by the panel every `interval` seconds: at most one poll of
 * GitHub per call (the interval is enforced here too). On success the user is looked up and a
 * 30-day session opens (HttpOnly cookie); the tokens stay in the secrets dir.
 */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { flowId?: unknown } | null;
  const flowId = typeof body?.flowId === "string" ? body.flowId : "";
  try {
    const result = await pollDeviceFlow(flowId);
    if (result.status !== "done") return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    const user = await getUser(result.tokens.access_token);
    const sessionId = createSession({ login: user.login, avatar_url: user.avatar_url, ...result.tokens });
    const res = NextResponse.json({ status: "done", user: { login: user.login, avatarUrl: user.avatar_url } }, { headers: { "Cache-Control": "no-store" } });
    res.cookies.set(SESSION_COOKIE, sessionId, cookieOptions(SESSION_DAYS * 86400));
    return res;
  } catch (err) {
    const status = err instanceof GitHubError && err.status >= 400 && err.status < 600 ? err.status : 502;
    return NextResponse.json({ status: "error", error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
