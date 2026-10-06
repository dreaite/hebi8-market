import { NextResponse, type NextRequest } from "next/server";
import { githubClientId } from "@/lib/app-info";
import { GitHubError, cancelDeviceFlow, crossSite, startDeviceFlow } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * 用 GitHub 登录, step 1: get a user code from GitHub (device flow, client id only). The device
 * code stays in server memory; the browser gets a random flow id to poll with.
 */
export async function POST(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const clientId = githubClientId();
  if (!clientId) return NextResponse.json({ error: "反馈未启用：没有配置 GitHub App 的 client id" }, { status: 409 });
  try {
    return NextResponse.json(await startDeviceFlow(clientId), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const status = err instanceof GitHubError && err.status >= 400 && err.status < 600 ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}

/** 取消: forget a pending login. */
export async function DELETE(request: NextRequest) {
  if (crossSite(request.headers)) return NextResponse.json({ error: "跨站请求被拒绝" }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { flowId?: unknown } | null;
  cancelDeviceFlow(body?.flowId);
  return NextResponse.json({ ok: true });
}
