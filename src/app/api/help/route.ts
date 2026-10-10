import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, webLoginClient } from "@/lib/github";
import { helpInfo } from "@/lib/help-info";
import { getSession } from "@/lib/secrets";
import { resolveViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";

/** The help panel's data: project facts, sync status, feedback setup and login. Never touches the network. */
export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get(SESSION_COOKIE)?.value;
  const info = helpInfo(resolveViewer(sessionId), { webLogin: Boolean(webLoginClient(request.headers)), token: Boolean(getSession(sessionId)?.access_token) });
  return NextResponse.json(info, { headers: { "Cache-Control": "no-store" } });
}
