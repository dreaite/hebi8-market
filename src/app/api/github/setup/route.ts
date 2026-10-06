import { NextResponse, type NextRequest } from "next/server";
import { requestOrigin, verifyInstallation } from "@/lib/github";
import { readApp, writeApp } from "@/lib/secrets";

export const dynamic = "force-dynamic";

/**
 * GitHub's "Setup URL": after the App is installed (or its repositories change). The query is
 * not trusted; the installation is checked with the App's JWT before it is stored.
 */
export async function GET(request: NextRequest) {
  const origin = requestOrigin(request.headers);
  const fail = (error: string) => {
    const url = new URL("/settings/github", origin);
    url.searchParams.set("error", error);
    return NextResponse.redirect(url);
  };
  const app = readApp();
  if (!app) return fail("还没有创建 GitHub App");
  const raw = request.nextUrl.searchParams.get("installation_id") ?? "";
  const id = /^\d{1,15}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(id)) {
    // "request" = an org member asked an owner to approve; nothing to store yet
    return fail(request.nextUrl.searchParams.get("setup_action") === "request" ? "安装申请已提交，等组织管理员批准后再回来" : "GitHub 没有带回 installation_id");
  }
  try {
    const installationId = await verifyInstallation(app, id);
    writeApp({ ...app, installation_id: installationId });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
  return NextResponse.redirect(new URL("/?help=feedback", origin));
}
