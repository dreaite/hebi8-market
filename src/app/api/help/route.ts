import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, webLoginClient } from "@/lib/github";
import { helpInfo } from "@/lib/help-info";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** The help panel's data: project facts, sync status, feedback setup and login. Never touches the network. */
export async function GET(request: NextRequest) {
  const info = helpInfo(resolveViewer(request.cookies.get(SESSION_COOKIE)?.value), { webLogin: Boolean(webLoginClient(request.headers)) });
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
