import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, crossSite } from "./github";
import { maySetBot, resolveViewer, type Viewer } from "./viewer";

export interface NotifyCaller {
  /** As GitHub spells it */
  login: string;
  vault: string;
  owner: string | null;
}

/**
 * Who a /api/notify call is for: always the logged-in viewer on a shared instance, never a login
 * from the request. Anything else gets the response to send back instead.
 */
export function notifyCaller(request: NextRequest): NotifyCaller | NextResponse {
  if (request.method !== "GET" && crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const viewer = resolveViewer(request.cookies.get(SESSION_COOKIE)?.value);
  if (!viewer.login) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  if (!viewer.shared) return NextResponse.json({ error: "单用户模式下通知通道写在 notify.json" }, { status: 409 });
  // owners share the root vault, so its channels live under the first owner whichever account binds
  return { login: viewer.isOwner ? viewer.owner! : viewer.login, vault: viewer.vault, owner: viewer.owner };
}

/** The instance settings caller, or the 403 (or cross-site refusal) to send back. */
export function botCaller(request: NextRequest): Viewer | NextResponse {
  if (request.method !== "GET" && crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const viewer = resolveViewer(request.cookies.get(SESSION_COOKIE)?.value);
  if (!maySetBot(viewer)) return NextResponse.json({ error: "只有实例的主人能设置 bot" }, { status: 403 });
  return viewer;
}
